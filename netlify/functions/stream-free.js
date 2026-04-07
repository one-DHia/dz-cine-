const axios = require('axios');
const { searchAkwam, getAkwamDownloadLink, resolveDirectLink } = require('./scrapers/akwam.js');

const TMDB_KEY = process.env.TMDB_KEY;
const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json'
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
        const year = (m.release_date || m.first_air_date || '').split('-')[0];

        console.log(`[OMEGA FREE] Recherche pour: ${title} (${year})`);

        // 2. Recherche Akwam
        const searchQuery = type === 'movie' ? `${title} ${year}` : `${title} S${season || 1}`;
        const results = await searchAkwam(searchQuery);

        if (!results || results.length === 0) {
            return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Contenu non trouvé sur Akwam' }) };
        }

        // 3. Extraction du lien de téléchargement
        const moviePage = results[0].link;
        const downloadLinks = await getAkwamDownloadLink(moviePage);

        if (!downloadLinks || downloadLinks.length === 0) {
            return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Aucun lien de téléchargement trouvé' }) };
        }

        // On tente de résoudre le premier lien (souvent la meilleure qualité)
        const target = downloadLinks[0].link;
        const directLink = await resolveDirectLink(target);

        if (directLink) {
            return {
                statusCode: 200,
                headers: HEADERS,
                body: JSON.stringify({
                    url: directLink,
                    quality: downloadLinks[0].quality || 'HD',
                    source: 'OMEGA FREE 🍃',
                    lang: 'V-ARAB'
                })
            };
        }

        return {
            statusCode: 404,
            headers: HEADERS,
            body: JSON.stringify({ error: 'Impossible d\'extraire le flux direct' })
        };

    } catch (e) {
        console.error('[Free Error]', e.message);
        return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
    }
};
