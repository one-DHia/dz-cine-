"""
╔════════════════════════════════════════════════════════════╗
║    DZ CINE OMEGA - Robot de Traduction "Pre-fill"          ║
║    Stratégie : Scanner TMDB → Traduire → Stocker Supabase  ║
╚════════════════════════════════════════════════════════════╝

Dépendances Python à installer :
    pip install requests deep-translator python-dotenv

Variables d'environnement requises (.env ou GitHub Secrets) :
    TMDB_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import os
import sys
import time
import json
import logging
import requests
from datetime import datetime
from dotenv import load_dotenv

# ── Charger le .env si présent (local), sinon utiliser les vars GitHub Actions
load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# ⚙️  CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
TMDB_KEY       = os.getenv("TMDB_KEY")
SUPABASE_URL   = os.getenv("SUPABASE_URL")
SUPABASE_SVC   = os.getenv("SUPABASE_SERVICE_KEY")
TMDB_BASE      = "https://api.themoviedb.org/3"

# Langues cibles et codes TMDB correspondants
LANGS = {
    "fr": "fr-FR",
    "en": "en-US",
    "ar": "ar-AE",
    "es": "es-ES",
    "pt": "pt-PT"
}

# Types de contenus à scanner
CONTENT_TYPES = [
    {"type": "movie",  "db_type": "movie"},
    {"type": "tv",     "db_type": "tv"},
    # Anime = films d'animation japonais
    {"type": "movie",  "db_type": "anime", "genre": 16, "lang_original": "ja"}
]

PAGES_TO_SCAN = 5   # Pages TMDB par type (20 résultats/page = 100 contenus max par type)
DELAY_BETWEEN_REQUESTS = 0.3  # secondes entre les requêtes (respecter le rate limit TMDB)

# ─────────────────────────────────────────────────────────────────────────────
# 📝 LOGGING
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("robot_translation.log", encoding="utf-8")
    ]
)
log = logging.getLogger("dz-cine-robot")

# ─────────────────────────────────────────────────────────────────────────────
# 🔑 VÉRIFICATION DES PRÉREQUIS
# ─────────────────────────────────────────────────────────────────────────────
def check_env():
    missing = []
    if not TMDB_KEY:     missing.append("TMDB_KEY")
    if not SUPABASE_URL: missing.append("SUPABASE_URL")
    if not SUPABASE_SVC: missing.append("SUPABASE_SERVICE_KEY")
    if missing:
        log.error(f"Variables manquantes : {', '.join(missing)}")
        sys.exit(1)
    log.info("✅ Variables d'environnement OK")

# ─────────────────────────────────────────────────────────────────────────────
# 🌐 TRADUCTEUR MAISON (Google Translate gratuit via l'API non-officielle)
# ─────────────────────────────────────────────────────────────────────────────
def translate_text(text: str, target_lang: str, source_lang: str = "en") -> str:
    """Traduit du texte en utilisant Google Translate (gratuit, pas de clé API)."""
    if not text or not text.strip():
        return ""
    if source_lang == target_lang:
        return text

    try:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": source_lang,
            "tl": target_lang,
            "dt": "t",
            "q": text[:4000]  # Limite max
        }
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        translated = "".join(part[0] for part in data[0] if part[0])
        time.sleep(DELAY_BETWEEN_REQUESTS)
        return translated
    except Exception as e:
        log.warning(f"⚠️  Traduction échouée ({target_lang}): {e}")
        return text  # Retourner l'original si la traduction échoue

# ─────────────────────────────────────────────────────────────────────────────
# 🎬 RÉCUPÉRER LES FILMS/SÉRIES DEPUIS TMDB
# ─────────────────────────────────────────────────────────────────────────────
def fetch_tmdb_discover(content_type_config: dict, page: int = 1) -> list:
    """Récupère une page de contenus depuis TMDB Discover."""
    tmdb_type = content_type_config["type"]
    genre     = content_type_config.get("genre", None)
    orig_lang = content_type_config.get("lang_original", None)

    params = {
        "api_key": TMDB_KEY,
        "language": "en-US",  # Source toujours en anglais
        "page": page,
        "sort_by": "popularity.desc",
        "include_adult": "false"
    }
    if genre:     params["with_genres"]           = genre
    if orig_lang: params["with_original_language"] = orig_lang

    try:
        resp = requests.get(f"{TMDB_BASE}/discover/{tmdb_type}", params=params, timeout=10)
        resp.raise_for_status()
        results = resp.json().get("results", [])
        log.info(f"   📥 TMDB {tmdb_type} (page {page}) → {len(results)} résultats")
        time.sleep(DELAY_BETWEEN_REQUESTS)
        return results
    except Exception as e:
        log.error(f"❌ TMDB Discover échoué : {e}")
        return []

# ─────────────────────────────────────────────────────────────────────────────
# 🛢️  SAUVEGARDER DANS SUPABASE
# ─────────────────────────────────────────────────────────────────────────────
def supabase_upsert(table: str, data: dict) -> bool:
    """Insère ou met à jour un enregistrement dans Supabase."""
    try:
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}",
            json=data,
            headers={
                "apikey": SUPABASE_SVC,
                "Authorization": f"Bearer {SUPABASE_SVC}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal"
            },
            timeout=10
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        log.error(f"❌ Supabase upsert échoué : {e}")
        return False

def supabase_log(log_type: str, message: str, details: dict = None) -> None:
    """Enregistre un log dans la table robot_logs de Supabase."""
    supabase_upsert("robot_logs", {
        "log_type": log_type,
        "message": message,
        "details": details or {}
    })

# ─────────────────────────────────────────────────────────────────────────────
# 🤖 LOGIQUE PRINCIPALE DU ROBOT
# ─────────────────────────────────────────────────────────────────────────────
def process_item(item: dict, db_type: str) -> bool:
    """Traduit un film/série et le sauvegarde dans Supabase."""
    tmdb_id     = item.get("id")
    title_en    = item.get("title") or item.get("name") or ""
    overview_en = item.get("overview") or ""
    poster      = item.get("poster_path")
    backdrop    = item.get("backdrop_path")
    vote        = item.get("vote_average", 0)
    date        = item.get("release_date") or item.get("first_air_date") or ""

    if not tmdb_id or not poster:
        return False  # Contenu sans affiche = pas pertinent

    log.info(f"   🎬 [{db_type}] Traitement : {title_en} (ID: {tmdb_id})")

    # Traduire titre et synopsis dans toutes les langues
    translations_data = {
        "tmdb_id":       tmdb_id,
        "content_type":  db_type,
        "poster_path":   poster,
        "backdrop_path": backdrop,
        "vote_average":  round(vote, 1),
        "release_date":  date[:10] if date else "",
        "updated_at":    datetime.utcnow().isoformat(),

        # Anglais (source, pas de traduction)
        "title_en":    title_en,
        "overview_en": overview_en,

        # Les autres langues
        "title_fr":    translate_text(title_en, "fr"),
        "title_ar":    translate_text(title_en, "ar"),
        "title_es":    translate_text(title_en, "es"),
        "title_pt":    translate_text(title_en, "pt"),

        "overview_fr": translate_text(overview_en, "fr"),
        "overview_ar": translate_text(overview_en, "ar"),
        "overview_es": translate_text(overview_en, "es"),
        "overview_pt": translate_text(overview_en, "pt"),
    }

    return supabase_upsert("translations", translations_data)


def run_robot():
    """Lance le scanner complet."""
    log.info("═══════════════════════════════════════════════")
    log.info("🤖 DZ CINE OMEGA - Robot de Traduction Démarré")
    log.info(f"⏰ Heure : {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
    log.info("═══════════════════════════════════════════════")

    check_env()

    total_success = 0
    total_errors  = 0

    for content_config in CONTENT_TYPES:
        db_type = content_config["db_type"]
        log.info(f"\n📂 Scan du type : {db_type.upper()}")

        for page_num in range(1, PAGES_TO_SCAN + 1):
            items = fetch_tmdb_discover(content_config, page=page_num)
            for item in items:
                success = process_item(item, db_type)
                if success: total_success += 1
                else:        total_errors  += 1

    log.info("\n═══════════════════════════════════════════════")
    log.info(f"✅ Traduction terminée : {total_success} succès, {total_errors} erreurs")
    log.info("═══════════════════════════════════════════════")

    # Logger dans Supabase
    status = "success" if total_errors == 0 else "warning"
    supabase_log(status, "Robot terminé", {"success": total_success, "errors": total_errors})

    # Quitter avec code d'erreur si trop d'échecs (déclenche l'alerte GitHub Actions)
    if total_errors > total_success and total_success == 0:
        log.error("🚨 Trop d'erreurs - signalement à GitHub Actions")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    run_robot()
