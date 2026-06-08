import logging
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.core.mail import EmailMultiAlternatives
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_otp_email_task(self, subject, template_name, context, recipient_email):
    html_content = render_to_string(f"emails/{template_name}", context)
    plain_content = strip_tags(html_content)
    msg = EmailMultiAlternatives(
        subject=subject,
        body=plain_content,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient_email],
    )
    msg.attach_alternative(html_content, "text/html")

    try:
        msg.send(fail_silently=False)
    except Exception as exc:
        logger.exception("Celery OTP email send failed for %s", recipient_email)
        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            logger.error("OTP email task retries exhausted for %s", recipient_email)
            raise
