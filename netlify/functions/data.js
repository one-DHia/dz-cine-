const axios = require('axios');

const TMDB_KEY      = process.env.TMDB_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const BASE_TMDB = 'https://api.themoviedb.org/3';
const VALID_TYPES = ['movie', 'tv', 'anime'];
const VALID_LANGS = ['fr', 'en', 'ar', 'es', 'pt'];

function sanitizePage(page) {
    const num = parseInt(page, 10);
    if (isNaN(num) || num < 1 || num > 500) return 1;
    return num;
}

function sanitizeString(str, maxLen = 150) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9\u0600-\u06FF\u00C0-\u024F\s\-_'.]/g, '').slice(0, maxLen);
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Content-Type': 'application/json'
    };

    try {
        const params = event.queryStringParameters || {};
        const type = VALID_TYPES.includes(params.type) ? params.type : 'movie';
        const lang = VALID_LANGS.includes(params.lang) ? params.lang : 'fr';
        const page = sanitizePage(params.page);
        const q    = sanitizeString(params.q, 150);

        // 1. Essayer Supabase si dispo et pas de recherche
        if (SUPABASE_URL && SUPABASE_ANON && !q) {
            try {
                const offset = (page - 1) * 20;
                const supaRes = await axios.get(
                    `${SUPABASE_URL}/rest/v1/translations?content_type=eq.${type}&select=tmdb_id,title_${lang},overview_${lang},poster_path,backdrop_path,vote_average,release_date&order=vote_average.desc&limit=20&offset=${offset}`,
                    {
                        headers: {
                            'apikey': SUPABASE_ANON,
                            'Authorization': `Bearer ${SUPABASE_ANON}`,
                            'Accept': 'application/json'
                        },
                        timeout: 5000
                    }
                );

                if (supaRes.data && supaRes.data.length > 0) {
                    const safe = supaRes.data.map(r => ({
                        id: r.tmdb_id,
                        title: r[`title_${lang}`] || r.title_fr || '',
                        overview: r[`overview_${lang}`] || r.overview_fr || '',
                        poster_path: r.poster_path,
                        backdrop_path: r.backdrop_path,
                        vote_average: r.vote_average || 0,
                        release_date: r.release_date || ''
                    }));
                    return { statusCode: 200, headers, body: JSON.stringify(safe) };
                }
            } catch (e) {
                console.warn('Supabase fallback:', e.message);
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

        return { statusCode: 200, headers, body: JSON.stringify(safe) };
    } catch (e) {
        console.error('[data]', e.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur.' }) };
    }
};
