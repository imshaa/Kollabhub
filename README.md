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
```

The settings currently use Gmail SMTP when `USE_REAL_EMAIL=True`.
