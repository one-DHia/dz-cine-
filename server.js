require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// 🔑 VARIABLES D'ENVIRONNEMENT (jamais hardcodées ici)
// ─────────────────────────────────────────────────────────────────────────────
const TMDB_KEY       = process.env.TMDB_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC   = process.env.SUPABASE_SERVICE_KEY;
const BASE_TMDB      = 'https://api.themoviedb.org/3';

if (!TMDB_KEY)      console.warn('⚠️  TMDB_KEY manquante dans .env');
if (!SUPABASE_URL)  console.warn('⚠️  SUPABASE_URL manquante dans .env');

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 EN-TÊTES DE SÉCURITÉ
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://image.tmdb.org data:; frame-src https://vidsrc.me https://vidsrc.xyz https://www.youtube.com; connect-src 'self' https://*.supabase.co;"
    );
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 CORS
// ─────────────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'];

app.use(cors({
    origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('CORS bloqué'));
    },
    methods: ['GET', 'POST'],
    credentials: false
}));

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 RATE LIMITING
// ─────────────────────────────────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 60;

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, start: now };
    if (now - entry.start > RATE_WINDOW_MS) { entry.count = 1; entry.start = now; }
    else entry.count++;
    rateLimitMap.set(ip, entry);
    if (entry.count > RATE_MAX) return res.status(429).json({ error: 'Trop de requêtes.' });
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap)
        if (now - entry.start > RATE_WINDOW_MS * 2) rateLimitMap.delete(ip);
}, RATE_WINDOW_MS * 2);

app.use('/api', rateLimit);

// ─────────────────────────────────────────────────────────────────────────────
// 🔧 VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
const VALID_TYPES = ['movie', 'tv', 'anime'];
const VALID_LANGS = ['fr', 'en', 'ar', 'es', 'pt'];

function sanitizeId(id) {
    if (!id) return null;
    const num = parseInt(id, 10);
    if (isNaN(num) || num <= 0 || num > 9999999) return null;
    return num;
}

function sanitizePage(page) {
    const num = parseInt(page, 10);
    if (isNaN(num) || num < 1 || num > 500) return 1;
    return num;
}

function sanitizeString(str, maxLen = 150) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9\u0600-\u06FF\u00C0-\u024F\s\-_'.]/g, '').slice(0, maxLen);
}

// ─────────────────────────────────────────────────────────────────────────────
// 🛢️  HELPERS SUPABASE REST (via axios, sans SDK pour éviter la dépendance)
// ─────────────────────────────────────────────────────────────────────────────
function supabaseGet(table, params = {}) {
    const queryString = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
    return axios.get(`${SUPABASE_URL}/rest/v1/${table}?${queryString}`, {
        headers: {
            'apikey': SUPABASE_ANON,
            'Authorization': `Bearer ${SUPABASE_ANON}`,
            'Accept': 'application/json'
        },
        timeout: 5000
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 📊 LOGGING VERS SUPABASE
// ─────────────────────────────────────────────────────────────────────────────
async function serverLog(type, message, details = null) {
    const entry = `[${type.toUpperCase()}] ${message}`;
    if (type === 'error') console.error(entry);
    else if (type === 'warning') console.warn(entry);
    else console.log(entry);

    if (!SUPABASE_URL || !SUPABASE_SVC) return;
    try {
        await axios.post(`${SUPABASE_URL}/rest/v1/robot_logs`, {
            log_type: type, message, details
        }, {
            headers: {
                'apikey': SUPABASE_SVC,
                'Authorization': `Bearer ${SUPABASE_SVC}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            timeout: 3000
        });
    } catch (_) { /* Silencieux pour ne pas bloquer la réponse */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// 📡 ROUTE /api/data – Depuis Supabase en priorité, TMDB en fallback
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
    try {
        const type  = VALID_TYPES.includes(req.query.type) ? req.query.type : 'movie';
        const lang  = VALID_LANGS.includes(req.query.lang) ? req.query.lang : 'fr';
        const page  = sanitizePage(req.query.page);
        const q     = sanitizeString(req.query.q, 150);

        // 1. Essayer Supabase si dispo
        if (SUPABASE_URL && !q) {
            try {
                const offset = (page - 1) * 20;
                const { data: rows } = await supabaseGet('translations', {
                    'content_type': `eq.${type}`,
                    'select': `tmdb_id,title_${lang},overview_${lang},poster_path,backdrop_path,vote_average,release_date`,
                    'order': 'vote_average.desc',
                    'limit': 20,
                    'offset': offset
                });

                if (rows && rows.length > 0) {
                    const safe = rows.map(r => ({
                        id: r.tmdb_id,
                        title: r[`title_${lang}`] || r.title_fr || '',
                        overview: r[`overview_${lang}`] || r.overview_fr || '',
                        poster_path: r.poster_path,
                        backdrop_path: r.backdrop_path,
                        vote_average: r.vote_average || 0,
                        release_date: r.release_date || ''
                    }));
                    return res.json(safe);
                }
            } catch (supaErr) {
                await serverLog('warning', 'Supabase indisponible, fallback TMDB', { error: supaErr.message });
            }
        }

        // 2. Fallback TMDB
        const tmdbLang = lang === 'ar' ? 'ar-AE' : lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : lang === 'pt' ? 'pt-PT' : 'en-US';
        const tmdbType = type === 'anime' ? 'movie' : type;
        let url;

        if (q) {
            url = `${BASE_TMDB}/search/${tmdbType}?api_key=${TMDB_KEY}&language=${tmdbLang}&query=${encodeURIComponent(q)}&page=${page}`;
        } else {
            url = `${BASE_TMDB}/discover/${tmdbType}?api_key=${TMDB_KEY}&language=${tmdbLang}&page=${page}&sort_by=popularity.desc`;
            if (type === 'anime') url += '&with_genres=16&with_original_language=ja';
        }

        const response = await axios.get(url, { timeout: 8000 });
        const results = Array.isArray(response.data.results) ? response.data.results : [];
        const safe = results.map(m => ({
            id: m.id,
            title: m.title || m.name || '',
            overview: m.overview || '',
            poster_path: m.poster_path || null,
            backdrop_path: m.backdrop_path || null,
            vote_average: typeof m.vote_average === 'number' ? m.vote_average : 0,
            release_date: m.release_date || m.first_air_date || '',
        }));
        res.json(safe);
    } catch (e) {
        await serverLog('error', '/api/data a échoué', { error: e.message });
        res.status(500).json({ error: 'Erreur lors du chargement des données.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 📡 ROUTE /api/details – Détails complets (fallback TMDB)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/details', async (req, res) => {
    try {
        const type = (req.query.type === 'anime' ? 'movie' : req.query.type) || 'movie';
        const lang = VALID_LANGS.includes(req.query.lang) ? req.query.lang : 'fr';
        const id   = sanitizeId(req.query.id);
        if (!id) return res.status(400).json({ error: 'ID invalide.' });

        const tmdbLang = lang === 'ar' ? 'ar-AE' : lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : lang === 'pt' ? 'pt-PT' : 'en-US';
        const url = `${BASE_TMDB}/${type}/${id}?api_key=${TMDB_KEY}&language=${tmdbLang}&append_to_response=credits,videos,seasons`;
        const { data: d } = await axios.get(url, { timeout: 8000 });

        const safe = {
            id: d.id,
            title: d.title || d.name || '',
            overview: d.overview || '',
            poster_path: d.poster_path || null,
            backdrop_path: d.backdrop_path || null,
            vote_average: d.vote_average || 0,
            seasons: (d.seasons || []).map(s => ({ season_number: s.season_number, name: s.name, episode_count: s.episode_count })),
            credits: {
                cast: (d.credits?.cast || []).slice(0, 10).map(a => ({
                    id: a.id, name: a.name || '', character: a.character || '', profile_path: a.profile_path || null
                }))
            },
            videos: {
                results: (d.videos?.results || []).filter(v => v.site === 'YouTube').map(v => ({ key: v.key, type: v.type, name: v.name }))
            }
        };
        res.json(safe);
    } catch (e) {
        await serverLog('error', '/api/details a échoué', { error: e.message });
        res.status(500).json({ error: 'Erreur lors du chargement des détails.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 📡 ROUTE /api/sources – Statut des sources vidéo
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/sources', async (req, res) => {
    try {
        if (!SUPABASE_URL) return res.json([{ source_name: 'vidsrc.me', is_active: true }, { source_name: 'vidsrc.xyz', is_active: true }]);
        const { data: sources } = await supabaseGet('source_status', { select: 'source_name,is_active,last_checked' });
        res.json(sources || []);
    } catch (e) {
        res.json([]);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 Route inconnue
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'Route API introuvable.' }));

// ─────────────────────────────────────────────────────────────────────────────
// 🌐 Fichiers statiques
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.static(__dirname, {
    index: false,    // On gère manuellement pour la landing page
    dotfiles: 'deny',
    extensions: ['html']
}));

// Route principale : redirecte vers login si pas auth, sinon index
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 catch-all
app.use((req, res) => res.status(404).send('Page introuvable.'));

// ─────────────────────────────────────────────────────────────────────────────
// 🚀 DÉMARRAGE
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n💎 DZ CINE OMEGA v3.0 – Architecture Supabase 🛢️`);
    console.log(`📡 Actif sur : http://localhost:${PORT}/`);
    console.log(`🛡️  Rate limit: ${RATE_MAX} req/min par IP`);
    console.log(`🌐 CORS autorisé : ${allowedOrigins.join(', ')}\n`);
});