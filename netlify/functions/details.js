const axios = require('axios');

const TMDB_KEY = process.env.TMDB_KEY;
const BASE_TMDB = 'https://api.themoviedb.org/3';
const VALID_TYPES = ['movie', 'tv'];
const VALID_LANGS = ['fr', 'en', 'ar', 'es', 'pt'];

function sanitizeId(id) {
    if (!id) return null;
    const num = parseInt(id, 10);
    if (isNaN(num) || num <= 0 || num > 9999999) return null;
    return num;
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Content-Type': 'application/json'
    };

    try {
        const params = event.queryStringParameters || {};
        const rawType = params.type === 'anime' ? 'movie' : params.type;
        const type = VALID_TYPES.includes(rawType) ? rawType : 'movie';
        const lang = VALID_LANGS.includes(params.lang) ? params.lang : 'fr';
        const id   = sanitizeId(params.id);

        if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ID invalide.' }) };

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
            seasons: (d.seasons || []).map(s => ({
                season_number: s.season_number,
                name: s.name,
                episode_count: s.episode_count
            })),
            credits: {
                cast: (d.credits?.cast || []).slice(0, 10).map(a => ({
                    id: a.id,
                    name: a.name || '',
                    character: a.character || '',
                    profile_path: a.profile_path || null
                }))
            },
            videos: {
                results: (d.videos?.results || [])
                    .filter(v => v.site === 'YouTube')
                    .map(v => ({ key: v.key, type: v.type, name: v.name }))
            }
        };

        return { statusCode: 200, headers, body: JSON.stringify(safe) };
    } catch (e) {
        console.error('[details]', e.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur.' }) };
    }
};
