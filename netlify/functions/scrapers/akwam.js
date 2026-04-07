const axios = require('axios');
const cheerio = require('cheerio');

const AKWAM_DOMAINS = ['https://akwam.re', 'https://akwam.to', 'https://akwams.org'];

async function searchAkwam(query) {
    for (const domain of AKWAM_DOMAINS) {
        try {
            console.log(`[Akwam] Searching on ${domain}...`);
            const searchUrl = `${domain}/search?q=${encodeURIComponent(query)}`;
            const { data: html } = await axios.get(searchUrl, { timeout: 5000 });
            const $ = cheerio.load(html);
            
            const results = [];
            $('.widget-item').each((i, el) => {
                const title = $(el).find('.subject-title').text().trim();
                const link = $(el).find('a').attr('href');
                if (title && link) {
                    results.push({ title, link: link.startsWith('http') ? link : `${domain}${link}` });
                }
            });

            if (results.length > 0) return results;
        } catch (e) {
            console.warn(`[Akwam] Domain ${domain} failed: ${e.message}`);
        }
    }
    return [];
}

async function getAkwamDownloadLink(pageUrl) {
    try {
        const { data: html } = await axios.get(pageUrl, { timeout: 5000 });
        const $ = cheerio.load(html);
        
        // Akwam often has a "Download" button that leads to a list of qualities
        const downloadLinks = [];
        $('.download-item').each((i, el) => {
            const quality = $(el).find('.quality').text().trim();
            const link = $(el).find('a').attr('href');
            if (link) {
                downloadLinks.push({ quality, link });
            }
        });
        
        return downloadLinks;
    } catch (e) {
        console.error(`[Akwam] Failed to get links from ${pageUrl}: ${e.message}`);
        return [];
    }
}

async function resolveDirectLink(downloadUrl) {
    try {
        // Akwam download links often go through a redirection page.
        // We need to fetch that page and find the actual "Download" button or wait for redirection.
        const { data: html, request } = await axios.get(downloadUrl, { 
            maxRedirects: 5,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' }
        });
        
        const $ = cheerio.load(html);
        
        // Strategy 1: Look for a direct video source or a button with a direct link
        const directLink = $('a.download-link').attr('href') || $('source').attr('src') || $('video').attr('src');
        
        if (directLink) return directLink;

        // Strategy 2: Check if we are already redirected to a file
        const finalUrl = request.res.responseUrl || downloadUrl;
        if (finalUrl.match(/\.(mp4|mkv|m3u8|webm)$/i)) return finalUrl;

        return null;
    } catch (e) {
        console.error(`[Akwam] Resolution failed for ${downloadUrl}: ${e.message}`);
        return null;
    }
}

module.exports = { searchAkwam, getAkwamDownloadLink, resolveDirectLink };
