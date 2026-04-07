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

module.exports = { searchAkwam, getAkwamDownloadLink };
