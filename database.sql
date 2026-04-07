-- ============================================================
-- 🚀 DZ CINE OMEGA - SCHÉMA SUPABASE
-- Exécuter ce script depuis l'éditeur SQL de Supabase
-- ============================================================

-- 1. Table des utilisateurs (gérée par Supabase Auth automatiquement)
-- On crée juste une table de profils supplémentaire
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table des traductions de contenus
CREATE TABLE IF NOT EXISTS public.translations (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER NOT NULL,
    content_type TEXT CHECK (content_type IN ('movie', 'tv', 'anime')) NOT NULL,
    title_fr TEXT,
    title_en TEXT,
    title_ar TEXT,
    title_es TEXT,
    title_pt TEXT,
    overview_fr TEXT,
    overview_en TEXT,
    overview_ar TEXT,
    overview_es TEXT,
    overview_pt TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    vote_average NUMERIC(3,1) DEFAULT 0,
    release_date TEXT,
    genres TEXT[], -- Tableau de genres
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tmdb_id, content_type)
);

-- Index pour accélérer les recherches
CREATE INDEX IF NOT EXISTS idx_translations_tmdb_id ON public.translations(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_translations_type ON public.translations(content_type);
CREATE INDEX IF NOT EXISTS idx_translations_updated ON public.translations(updated_at DESC);

-- 3. Table de statut des sources vidéo
CREATE TABLE IF NOT EXISTS public.source_status (
    id SERIAL PRIMARY KEY,
    source_name TEXT NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    last_checked TIMESTAMPTZ DEFAULT NOW(),
    error_count INTEGER DEFAULT 0,
    notes TEXT
);

-- Insérer les sources par défaut
INSERT INTO public.source_status (source_name, is_active) VALUES
    ('vidsrc.me', TRUE),
    ('vidsrc.xyz', TRUE)
ON CONFLICT (source_name) DO NOTHING;

-- 4. Table de logs du robot et du serveur
CREATE TABLE IF NOT EXISTS public.robot_logs (
    id SERIAL PRIMARY KEY,
    log_type TEXT CHECK (log_type IN ('info', 'warning', 'error', 'success')) NOT NULL,
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour ne conserver que les 30 derniers jours
CREATE INDEX IF NOT EXISTS idx_robot_logs_created ON public.robot_logs(created_at DESC);

-- ============================================================
-- 🔒 ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Activer RLS sur toutes les tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.robot_logs ENABLE ROW LEVEL SECURITY;

-- Politiques pour profiles : chaque utilisateur voit/modifie uniquement son profil
CREATE POLICY "Users can view own profile" ON public.profiles 
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles 
    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles 
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Politiques pour translations : lecture publique (tout le monde peut lire), écriture serveur uniquement
CREATE POLICY "Translations are publicly readable" ON public.translations 
    FOR SELECT USING (TRUE);

-- Politiques pour source_status : lecture publique
CREATE POLICY "Source status is publicly readable" ON public.source_status 
    FOR SELECT USING (TRUE);

-- Politiques pour robot_logs : lecture par les admins uniquement (via service key)
-- (pas de politique SELECT publique = accès via service role key uniquement)

-- ============================================================
-- 🔧 FONCTION TRIGGER : Créer profil à l'inscription
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'username');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
