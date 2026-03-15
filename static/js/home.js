// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Header hide on scroll
let lastScroll = 0;
const header = document.querySelector('.header');

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset;

  if (currentScroll > lastScroll && currentScroll > 100) {
    header.style.transform = 'translateY(-100%)';
  } else {
    header.style.transform = 'translateY(0)';
  }

  lastScroll = currentScroll;
});






// Basic chat input functionality simulation without backend
  // (() => {
  //   const chatInput = document.getElementById('chatInput');
  //   const chatSendBtn = document.getElementById('chatSendBtn');
  //   const chatMessages = document.getElementById('chatMessages');
  //   const chatForm = document.getElementById('chatForm');

  //   chatInput.addEventListener('input', () => {
  //     chatSendBtn.disabled = !chatInput.value.trim();
  //   });

  //   chatForm.addEventListener('submit', (e) => {
  //     e.preventDefault();
  //     const userText = chatInput.value.trim();
  //     if(userText === '') return;
  //     // Append user message bubble
  //     const userMessage = document.createElement('div');
  //     userMessage.className = 'chat-message user';
  //     userMessage.setAttribute('aria-label', 'Your message');
  //     userMessage.textContent = userText;
  //     chatMessages.appendChild(userMessage);

  //     chatInput.value = '';
  //     chatSendBtn.disabled = true;
  //     chatMessages.scrollTop = chatMessages.scrollHeight;

  //     // Simulate assistant reply (basic canned responses)
  //     setTimeout(() => {
  //       const assistantReply = document.createElement('div');
  //       assistantReply.className = 'chat-message';
  //       assistantReply.setAttribute('aria-label', 'Message from Kollab Assistant');
  //       let reply = "I'm here to help! Try asking me about features, task management, or team collaboration.";
  //       if (userText.toLowerCase().includes('feature')) {
  //         reply = "KollabHub offers real-time messaging, file sharing, audio/video calls and AI task assistance.";
  //       } else if (userText.toLowerCase().includes('task')) {
  //         reply = "You can create and assign tasks using visual boards, and track progress effortlessly.";
  //       } else if (userText.toLowerCase().includes('team')) {
  //         reply = "Our platform enables your team to collaborate seamlessly, whether remote or in-office.";
  //       }
  //       assistantReply.textContent = reply;
  //       chatMessages.appendChild(assistantReply);
  //       chatMessages.scrollTop = chatMessages.scrollHeight;
  //     }, 1000);
  //   });
  // })();