from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def get_env_var(name: str, default=None, required=False):
    value = os.environ.get(name, default)
    if required and value in (None, ""):
        raise ImproperlyConfigured(f"Set the {name} environment variable.")
    return value


# ═══════════════════════════════════════════════════════════════════
#  CORE
# ═══════════════════════════════════════════════════════════════════

CSRF_TRUSTED_ORIGINS = [
    "https://web-production-aa3f.up.railway.app",
]

SECRET_KEY = get_env_var("SECRET_KEY", required=True)

DEBUG = get_env_var("DEBUG", "False").lower() in ("1", "true", "yes")

ALLOWED_HOSTS = [
    host.strip()
    for host in get_env_var("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

SUPABASE_URL         = get_env_var("SUPABASE_URL",         required=True)
SUPABASE_KEY         = get_env_var("SUPABASE_KEY",         required=True)
SUPABASE_SERVICE_KEY = get_env_var("SUPABASE_SERVICE_KEY", required=True)
SUPABASE_BUCKET      = get_env_var("SUPABASE_BUCKET",      required=True)


# ═══════════════════════════════════════════════════════════════════
#  INSTALLED APPS & MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'kollabapp',
    'channels',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'kollabproject.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

ASGI_APPLICATION = 'kollabproject.asgi.application'


# ═══════════════════════════════════════════════════════════════════
#  CHANNELS  (Redis in production, in-memory fallback for dev)
# ═══════════════════════════════════════════════════════════════════

_redis_url = get_env_var("REDIS_URL", "redis://127.0.0.1:6379/0")

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [_redis_url],
            "capacity": 1500,
            "expiry": 10,
        },
    },
}


# ═══════════════════════════════════════════════════════════════════
#  CELERY  (broker ready for future tasks — no email tasks used)
# ═══════════════════════════════════════════════════════════════════

CELERY_BROKER_URL     = get_env_var("CELERY_BROKER_URL", _redis_url)
CELERY_RESULT_BACKEND = get_env_var("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)

CELERY_ACCEPT_CONTENT    = ["json"]
CELERY_TASK_SERIALIZER   = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE          = "UTC"
CELERY_ENABLE_UTC        = True

_force_eager = get_env_var("CELERY_ALWAYS_EAGER", "").lower() in ("1", "true", "yes")
CELERY_TASK_ALWAYS_EAGER     = DEBUG or _force_eager
CELERY_TASK_EAGER_PROPAGATES = CELERY_TASK_ALWAYS_EAGER

CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_BROKER_CONNECTION_MAX_RETRIES      = 3
CELERY_BROKER_TRANSPORT_OPTIONS = {
    "socket_timeout":         5,
    "socket_connect_timeout": 5,
}


# ═══════════════════════════════════════════════════════════════════
#  DATABASE
# ═══════════════════════════════════════════════════════════════════

DATABASES = {
    "default": {
        "ENGINE":   "django.db.backends.postgresql",
        "NAME":     os.environ.get("DB_NAME"),
        "USER":     os.environ.get("DB_USER"),
        "PASSWORD": os.environ.get("DB_PASSWORD"),
        "HOST":     os.environ.get("DB_HOST", "localhost"),
        "PORT":     os.environ.get("DB_PORT", "5432"),
        "OPTIONS":  {"sslmode": "require"},
    }
}


# ═══════════════════════════════════════════════════════════════════
#  DAILY.CO
# ═══════════════════════════════════════════════════════════════════

DAILY_API_KEY = os.environ.get("DAILY_API_KEY", "")
DAILY_API_URL = "https://api.daily.co/v1"


# ═══════════════════════════════════════════════════════════════════
#  AUTH & PASSWORD VALIDATION
# ═══════════════════════════════════════════════════════════════════

AUTH_USER_MODEL = "kollabapp.CustomUser"
LOGIN_URL       = "/login/"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# ═══════════════════════════════════════════════════════════════════
#  INTERNATIONALISATION
# ═══════════════════════════════════════════════════════════════════

LANGUAGE_CODE = "en-us"
TIME_ZONE     = "UTC"
USE_I18N      = True
USE_TZ        = True


# ═══════════════════════════════════════════════════════════════════
#  STATIC & MEDIA
# ═══════════════════════════════════════════════════════════════════

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATICFILES_STORAGE = "whitenoise.storage.CompressedStaticFilesStorage"

MEDIA_URL  = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

