from django.contrib.messages import constants as messages
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

SECRET_KEY = get_env_var("SECRET_KEY", required=True)

DEBUG = get_env_var("DEBUG", "False").lower() in ("1", "true", "yes")

ALLOWED_HOSTS = [
    host.strip()
    for host in get_env_var("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

SUPABASE_URL = get_env_var("SUPABASE_URL", required=True)
SUPABASE_KEY = get_env_var("SUPABASE_KEY", required=True)
SUPABASE_SERVICE_KEY = get_env_var("SUPABASE_SERVICE_KEY", required=True)
SUPABASE_BUCKET = get_env_var("SUPABASE_BUCKET", required=True)


# Application definition

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
        'DIRS': [ BASE_DIR / 'templates' ],
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

# WSGI_APPLICATION = 'kollabproject.wsgi.application'
ASGI_APPLICATION = 'kollabproject.asgi.application'

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [("127.0.0.1", 6379)],
            "capacity": 1500,
            "expiry": 10,
        },
    },
}

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


STATIC_URL = 'static/'

STATICFILES_DIRS = [
    BASE_DIR / "static",
]


DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

AUTH_USER_MODEL = 'kollabapp.CustomUser'
LOGIN_URL = '/login/'
