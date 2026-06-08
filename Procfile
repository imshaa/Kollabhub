web: daphne -b 0.0.0.0 -p $PORT kollabproject.asgi:application
worker: celery -A kollabproject worker --loglevel=info --concurrency=2