
import os
import django
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from django.core.asgi import get_asgi_application
from django.conf import settings

# In development only: serve static files over ASGI when using an ASGI server
try:
    from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler
except Exception:
    ASGIStaticFilesHandler = None

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'kollabproject.settings')

django.setup()

import kollabapp.routing


application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(
            kollabapp.routing.websocket_urlpatterns
        )
    ),
})

# Wrap with staticfiles handler in DEBUG so Daphne (or any ASGI server)
# can serve static files during development. In production use WhiteNoise
# or a proper static file server.
if settings.DEBUG and ASGIStaticFilesHandler is not None:
    application = ASGIStaticFilesHandler(application)
