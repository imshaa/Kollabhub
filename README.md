# KolabDemo
Main Kolabhub Project

## Email Setup

This project sends signup and password-reset OTP emails using the Django email backend.

In local development, email is only written to the console unless real SMTP is enabled.

To receive actual OTP emails, add the following to your `.env` file:

```env
USE_REAL_EMAIL=True
EMAIL_HOST_USER=your-email@example.com
EMAIL_HOST_PASSWORD=your-email-password-or-app-password
REDIS_URL=redis://127.0.0.1:6379/0
CELERY_BROKER_URL=redis://127.0.0.1:6379/0
CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/0
```

The settings currently use Gmail SMTP when `USE_REAL_EMAIL=True`.

### Celery Email Worker

OTP email delivery is performed by Celery tasks in the background. Start a worker in production or development using:

```bash
celery -A kollabproject worker --loglevel=info
```

If you run Django with `DEBUG=True`, Celery tasks execute eagerly for local convenience.
