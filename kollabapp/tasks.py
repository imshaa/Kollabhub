import logging
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.core.mail import EmailMultiAlternatives
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def send_otp_email_task(self, subject, template_name, context, recipient_email):
    try:
        html_content  = render_to_string(f"emails/{template_name}", context)
        plain_content = strip_tags(html_content)
        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient_email],
        )
        msg.attach_alternative(html_content, "text/html")
        msg.send(fail_silently=False)
        logger.info("OTP email sent successfully to %s", recipient_email)
    except Exception as exc:
        logger.exception("OTP email send failed for %s", recipient_email)
        raise self.retry(exc=exc)   # raises Retry, does NOT fall through