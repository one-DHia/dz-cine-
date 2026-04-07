require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

// 🥷 IMPORTATION DU MODE STEALTH
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TMDB_KEY = process.env.TMDB_KEY || process.env.TMDB_API_KEY;

const bot = new Telegraf(BOT_TOKEN);

// ==========================================
// 🕵️ FONCTION D'EXTRACTION (V4 - MODE STEALTH)
// ==========================================
async function extractCleanVideoUrl(tmdbId) {
    console.log(`[Extrait] Démarrage de l'extraction STEALTH pour l'ID: ${tmdbId}...`);

    const browser = await puppeteer.launch({
        headless: "new", // On peut retenter en invisible grâce au stealth
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();
    let finalVideoUrl = null;

    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        const resourceType = request.resourceType();

        // On cherche spécifiquement les playlists m3u8 ou mp4
        if (url.includes('.m3u8') || url.includes('.mp4')) {
            console.log(`[SUCCÈS] Lien vidéo trouvé : ${url}`);
            finalVideoUrl = url;
            request.continue();
        } else if (['image', 'font'].includes(resourceType)) {
            // Bloquer les images pour aller plus vite, mais on laisse les scripts
            request.abort();
        } else {
            request.continue();
        }
    });

    try {
        const targetUrl = `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`;
        console.log(`[Extrait] Navigation vers : ${targetUrl}`);

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        console.log("[Extrait] Page chargée, attente des scripts anti-bot...");
        await new Promise(r => setTimeout(r, 4000));

        // Extraction de l'URL de l'iframe interne si vidsrc fait une redirection interne
        const iframeSrc = await page.evaluate(() => {
            const iframe = document.querySelector('iframe');
            return iframe ? iframe.src : null;
        });

        if (iframeSrc) {
            console.log(`[Extrait] Iframe interne trouvée, navigation vers : ${iframeSrc}`);
            await page.goto(iframeSrc, { waitUntil: 'networkidle2', timeout: 20000 });
            await new Promise(r => setTimeout(r, 3000));
        }

        console.log("[Extrait] Simulation d'interaction humaine...");
        await page.mouse.click(page.viewport().width / 2, page.viewport().height / 2);
        await new Promise(r => setTimeout(r, 1000));
        await page.mouse.click(page.viewport().width / 2, page.viewport().height / 2);

        // Attente finale pour voir si le flux démarre
        await new Promise(r => setTimeout(r, 6000));

    } catch (error) {
        console.error("[Erreur d'extraction]", error.message);
    } finally {
        await browser.close();
    }

    return finalVideoUrl;
}

// ==========================================
// 🤖 LOGIQUE DU BOT TELEGRAM
// ==========================================

bot.start((ctx) => {
    ctx.reply("🍿 Bienvenue sur DZ CINE OMEGA Bot !\nEnvoie-moi simplement le nom d'un film que tu veux regarder.");
});

bot.on('text', async (ctx) => {
    const query = ctx.message.text;

    if (query.startsWith('/')) return;

    const statusMessage = await ctx.reply(`🔍 Recherche de "*${query}*" en cours...`, { parse_mode: 'Markdown' });

    try {
        const searchRes = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&language=fr-FR&query=${encodeURIComponent(query)}`);
        const movie = searchRes.data.results[0];

        if (!movie) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMessage.message_id, null, "❌ Film introuvable. Essaie un autre titre.");
        }

        await ctx.telegram.editMessageText(ctx.chat.id, statusMessage.message_id, null, `⏳ Film trouvé : *${movie.title}* !\n🛠️ Extraction de la vidéo sans pubs en cours (ça peut prendre 10 à 15 secondes)...`, { parse_mode: 'Markdown' });

        const streamUrl = await extractCleanVideoUrl(movie.id);

        if (streamUrl) {
            await ctx.replyWithPhoto(
                { url: `https://image.tmdb.org/t/p/w500${movie.poster_path}` },
                {
                    caption: `🎬 *${movie.title}* (${movie.release_date ? movie.release_date.split('-')[0] : 'N/A'})\n\n⭐ Note: ${movie.vote_average}/10\n\n✅ *Lien vidéo direct extrait avec succès !*`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "▶️ Regarder le flux brut (Sans Pubs)", url: streamUrl }],
                            [{ text: "🌐 Voir sur DZ CINE OMEGA", url: `https://dzcinema.onrender.com/?id=${movie.id}` }]
                        ]
                    }
                }
            );
            ctx.deleteMessage(statusMessage.message_id);
        } else {
            ctx.telegram.editMessageText(ctx.chat.id, statusMessage.message_id, null, `⚠️ *${movie.title}* trouvé, mais impossible d'extraire la vidéo directe pour le moment. Vidsrc bloque les requêtes.\n\n👉 Tu peux le regarder directement et gratuitement sur le site web :`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🌐 Regarder sur DZ CINE OMEGA", url: `https://dzcinema.onrender.com/?id=${movie.id}` }]
                    ]
                }
            });
        }

    } catch (error) {
        console.error(error);
        ctx.telegram.editMessageText(ctx.chat.id, statusMessage.message_id, null, "💥 Une erreur est survenue pendant la recherche.");
    }
});

bot.launch().then(() => {
    console.log("🚀 DZ CINE OMEGA Bot (Mode Stealth) est en ligne !");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));