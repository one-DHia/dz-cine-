const axios = require('axios');
const { searchAkwam, getAkwamDownloadLink } = require('./scrapers/akwam.js');

// CONFIGURATION
const RD_KEY = process.env.REAL_DEBRID_KEY;
const TMDB_KEY = process.env.TMDB_KEY;
const RD_BASE_URL = 'https://api.real-debrid.com/rest/1.0';

// HEADERS
const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json'
};

const RD = {
    async unrestrict(link) {
        try {
            const res = await axios.post(`${RD_BASE_URL}/unrestrict/link`, `link=${encodeURIComponent(link)}`, {
                headers: { 'Authorization': `Bearer ${RD_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            return res.data.download;
        } catch (e) {
            console.error('[RD Unrestrict Error]', e.message);
            return null;
        }
    }
};

exports.handler = async (event) => {
    try {
        const { id, type, season, episode } = event.queryStringParameters || {};
        if (!id) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'ID TMDB requis' }) };
        
        // 1. Infos TMDB
        const tmdbType = type === 'anime' ? 'movie' : type;
        const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${id}?api_key=${TMDB_KEY}&language=en-US`;
        const { data: m } = await axios.get(tmdbUrl);
        const title = m.title || m.name;
        const year = (m.release_date || m.first_air_date || m.air_date || '').split('-')[0];

        console.log(`[OMEGA PREMIUM] Recherche Akwam pour: ${title} (${year})`);

        // 2. RECHERCHE AKWAM (Priorité V-ARAB)
        const searchQuery = type === 'movie' ? `${title} ${year}` : `${title} S${season || 1}`;
        const results = await searchAkwam(searchQuery);
        
        let bestLink = null;
        if (results && results.length > 0) {
            // On prend le premier résultat qui match le mieux (Akwam trie souvent bien)
            const moviePage = results[0].link;
            const downloadLinks = await getAkwamDownloadLink(moviePage);
            
            if (downloadLinks && downloadLinks.length > 0) {
                // On prend la meilleure qualité dispo (les premiers souvent)
                const target = downloadLinks[0].link;
                
                // 3. UNRESTRICT VIA REAL-DEBRID (si configuré)
                if (RD_KEY) {
                    bestLink = await RD.unrestrict(target);
                } else {
                    // Fallback direct (attention aux pubs)
                    bestLink = target;
                }
            }
        }

        if (bestLink) {
            return {
                statusCode: 200,
                headers: HEADERS,
                body: JSON.stringify({
                    url: bestLink,
                    quality: 'PREMIUM',
                    source: 'OMEGA Akwam 💎',
                    lang: 'V-ARAB'
                })
            };
        }

        return {
            statusCode: 404,
            headers: HEADERS,
            body: JSON.stringify({ error: 'Aucun flux premium Akwam trouvé.' })
        };

    } catch (e) {
        console.error('[Premium Error]', e.message);
        return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
    }
};
