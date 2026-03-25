import { initReveal } from './reveal.js';
import { initFlowField } from './flow-field.js';

import { initUnfilteredCanvas } from './unfiltered-canvas.js';

let _cleanup = null;

function initValidationFlow() {
  const requestModal = document.getElementById('request-access-modal');
  const feedbackModal = document.getElementById('feedback-modal');

  if (!requestModal || !feedbackModal) {
    console.warn('Missing request-access-modal or feedback-modal in index.html');
    return null;
  }

  const requestPanel = requestModal.querySelector('.request-access-panel');
  const requestBackdrop = requestModal.querySelector('.request-access-backdrop');
  const requestCloseButton = requestModal.querySelector('.request-access-close');
  const requestForm = requestModal.querySelector('#request-access-form');
  const requestBody = requestModal.querySelector('.request-access-body');

  const emailInput = requestModal.querySelector('#request-access-email');
  const roleInput = requestModal.querySelector('#request-access-role');
  const honeypotInput = requestModal.querySelector('#request-access-honeypot');
  const consentInput = requestModal.querySelector('#request-access-consent');

  const emailError = requestModal.querySelector('#request-access-email-error');
  const consentError = requestModal.querySelector('#request-access-consent-error');
  const requestFormMessage = requestModal.querySelector('#request-access-form-message');
  const requestSubmitButton = requestModal.querySelector('.request-access-submit');

  const feedbackPanel = feedbackModal.querySelector('.feedback-panel');
  const feedbackBackdrop = feedbackModal.querySelector('.feedback-backdrop');
  const feedbackCloseButton = feedbackModal.querySelector('.feedback-close');
  const feedbackForm = feedbackModal.querySelector('#feedback-form');
  const feedbackBody = feedbackModal.querySelector('.feedback-body');
  const feedbackLeadIdInput = feedbackModal.querySelector('#feedback-lead-id');
  const feedbackTopNeedsError = feedbackModal.querySelector('#feedback-top-needs-error');
  const feedbackFormMessage = feedbackModal.querySelector('#feedback-form-message');
  const feedbackSubmitButton = feedbackModal.querySelector('#feedback-submit');
  const feedbackSkipButton = feedbackModal.querySelector('#feedback-skip');
  const feedbackFreeTextInput = feedbackModal.querySelector('#feedback-free-text');

  const triggers = Array.from(
    document.querySelectorAll('[data-request-access-trigger], a.nav-cta, a.cta-primary, a.cta-btn')
  );

  let lastTrigger = null;
  let activeController = null;
  let activeModal = null;
  let requestSubmitting = false;
  let feedbackSubmitting = false;
  let requestSuccessState = null;
  let feedbackSuccessState = null;
  let bodyOverflowBeforeOpen = '';

  const defaultRequestSubmitText = requestSubmitButton ? requestSubmitButton.textContent.trim() : 'Submit Request';
  const defaultFeedbackSubmitText = feedbackSubmitButton ? feedbackSubmitButton.textContent.trim() : 'Submit Feedback';

  const apiBase =
  window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? (window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3001' : 'http://localhost:3001')
    : 'https://klaedon-backend.onrender.com';
    
  function setText(el, text = '') {
    if (el) el.textContent = text;
  }

  function lockScroll() {
    if (!bodyOverflowBeforeOpen) {
      bodyOverflowBeforeOpen = document.body.style.overflow;
    }
    document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    if (activeModal) return;
    document.body.style.overflow = bodyOverflowBeforeOpen;
    bodyOverflowBeforeOpen = '';
  }

  function getFocusableElements(panel) {
    if (!panel) return [];

    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    return Array.from(panel.querySelectorAll(selectors)).filter((el) => {
      return !el.hasAttribute('hidden') && el.offsetParent !== null;
    });
  }

  function getActivePanel() {
    if (activeModal === 'request') return requestPanel;
    if (activeModal === 'feedback') return feedbackPanel;
    return null;
  }

  function showRequestModal() {
    requestModal.hidden = false;
    requestModal.setAttribute('aria-hidden', 'false');
    activeModal = 'request';
    lockScroll();

    window.requestAnimationFrame(() => {
      emailInput?.focus();
    });
  }

  function hideRequestModal({ restoreFocus = true, reset = true, unlock = true } = {}) {
    requestModal.hidden = true;
    requestModal.setAttribute('aria-hidden', 'true');

    if (reset) resetRequestState();

    if (activeModal === 'request') {
      activeModal = null;
      if (unlock) unlockScroll();
    }

    if (restoreFocus && lastTrigger && typeof lastTrigger.focus === 'function') {
      lastTrigger.focus();
    }
  }

  function showFeedbackModal(leadId) {
    if (feedbackLeadIdInput) {
      feedbackLeadIdInput.value = String(leadId || '');
    }

    feedbackModal.hidden = false;
    feedbackModal.setAttribute('aria-hidden', 'false');
    activeModal = 'feedback';
    lockScroll();

    window.requestAnimationFrame(() => {
      const firstTopNeed = feedbackForm?.querySelector('input[name="top_needs"]');
      firstTopNeed?.focus();
    });
  }

  function hideFeedbackModal({ restoreFocus = true, reset = true } = {}) {
    feedbackModal.hidden = true;
    feedbackModal.setAttribute('aria-hidden', 'true');

    if (reset) resetFeedbackState();

    if (activeModal === 'feedback') {
      activeModal = null;
      unlockScroll();
    }

    if (restoreFocus && lastTrigger && typeof lastTrigger.focus === 'function') {
      lastTrigger.focus();
    }
  }

  function openRequestModal(event) {
    event?.preventDefault();
    lastTrigger = event?.currentTarget || null;
    resetRequestState();
    resetFeedbackState();
    showRequestModal();
  }

  function setEmailError(message = '') {
    const hasError = Boolean(message);
    emailInput?.setAttribute('aria-invalid', hasError ? 'true' : 'false');
    setText(emailError, message);
    if (emailError) emailError.hidden = !hasError;
  }

  function setConsentError(message = '') {
    const hasError = Boolean(message);
    consentInput?.setAttribute('aria-invalid', hasError ? 'true' : 'false');
    setText(consentError, message);
    if (consentError) consentError.hidden = !hasError;
  }

  function setRequestFormMessage(message = '', type = 'status') {
    const hasMessage = Boolean(message);
    setText(requestFormMessage, message);
    if (requestFormMessage) {
      requestFormMessage.hidden = !hasMessage;
      requestFormMessage.dataset.state = type;
    }
  }

  function clearRequestMessages() {
    setEmailError('');
    setConsentError('');
    setRequestFormMessage('');
  }

  function setFeedbackTopNeedsError(message = '') {
    const hasError = Boolean(message);
    setText(feedbackTopNeedsError, message);
    if (feedbackTopNeedsError) feedbackTopNeedsError.hidden = !hasError;
  }

  function setFeedbackFormMessage(message = '', type = 'status') {
    const hasMessage = Boolean(message);
    setText(feedbackFormMessage, message);
    if (feedbackFormMessage) {
      feedbackFormMessage.hidden = !hasMessage;
      feedbackFormMessage.dataset.state = type;
    }
  }

  function clearFeedbackMessages() {
    setFeedbackTopNeedsError('');
    setFeedbackFormMessage('');
  }

  function renderRequestSuccess(message) {
    if (!requestBody || !requestForm) return;

    requestForm.hidden = true;
    setRequestFormMessage('');

    if (!requestSuccessState) {
      requestSuccessState = document.createElement('div');
      requestSuccessState.className = 'request-access-success';
    }

    requestSuccessState.innerHTML = `
      <div class="request-access-success-title">Request received</div>
      <p class="request-access-success-body">${message}</p>
    `;

    if (!requestSuccessState.parentNode) {
      requestBody.appendChild(requestSuccessState);
    }
  }

  function removeRequestSuccess() {
    if (requestSuccessState?.parentNode) {
      requestSuccessState.parentNode.removeChild(requestSuccessState);
    }
  }

  function renderFeedbackSuccess(message) {
    if (!feedbackBody || !feedbackForm) return;

    feedbackForm.hidden = true;
    setFeedbackFormMessage('');

    if (!feedbackSuccessState) {
      feedbackSuccessState = document.createElement('div');
      feedbackSuccessState.className = 'feedback-success';
    }

    feedbackSuccessState.innerHTML = `
      <div class="feedback-success-title">Feedback received</div>
      <p class="feedback-success-body">${message}</p>
    `;

    if (!feedbackSuccessState.parentNode) {
      feedbackBody.appendChild(feedbackSuccessState);
    }
  }

  function removeFeedbackSuccess() {
    if (feedbackSuccessState?.parentNode) {
      feedbackSuccessState.parentNode.removeChild(feedbackSuccessState);
    }
  }

  function setRequestSubmittingState(active) {
    requestSubmitting = active;
    if (!requestSubmitButton) return;

    requestSubmitButton.disabled = active;
    requestSubmitButton.setAttribute('aria-disabled', active ? 'true' : 'false');
    requestSubmitButton.textContent = active ? 'Submitting...' : defaultRequestSubmitText;
  }

  function setFeedbackSubmittingState(active) {
    feedbackSubmitting = active;

    if (feedbackSubmitButton) {
      feedbackSubmitButton.disabled = active;
      feedbackSubmitButton.setAttribute('aria-disabled', active ? 'true' : 'false');
      feedbackSubmitButton.textContent = active ? 'Submitting...' : defaultFeedbackSubmitText;
    }

    if (feedbackSkipButton) {
      feedbackSkipButton.disabled = active;
    }
  }

  function abortActiveRequest() {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
  }

  function resetRequestState() {
    abortActiveRequest();
    setRequestSubmittingState(false);
    clearRequestMessages();
    removeRequestSuccess();

    if (requestForm) {
      requestForm.hidden = false;
      requestForm.reset();
    }
  }

  function resetFeedbackState() {
    setFeedbackSubmittingState(false);
    clearFeedbackMessages();
    removeFeedbackSuccess();

    if (feedbackForm) {
      feedbackForm.hidden = false;
      feedbackForm.reset();
    }

    if (feedbackLeadIdInput) {
      feedbackLeadIdInput.value = '';
    }
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validateRequestForm() {
    const email = emailInput?.value.trim() || '';
    const consent = Boolean(consentInput?.checked);

    clearRequestMessages();

    if (!email) {
      setEmailError('Email address is required.');
      emailInput?.focus();
      return false;
    }

    if (!isValidEmail(email)) {
      setEmailError('Enter a valid email address.');
      emailInput?.focus();
      return false;
    }

    if (!consent) {
      setConsentError('Consent is required.');
      consentInput?.focus();
      return false;
    }

    return true;
  }

  function getSelectedTopNeeds() {
    return Array.from(feedbackForm?.querySelectorAll('input[name="top_needs"]:checked') || []).map((input) => input.value);
  }

  function getSelectedRadioValue(name) {
    const selected = feedbackForm?.querySelector(`input[name="${name}"]:checked`);
    return selected ? selected.value : '';
  }

  function validateFeedbackForm() {
    clearFeedbackMessages();

    const leadId = feedbackLeadIdInput?.value.trim() || '';
    const topNeeds = getSelectedTopNeeds();

    if (!leadId) {
      setFeedbackFormMessage('Missing lead reference. Re-submit the access request.', 'error');
      return false;
    }

    if (!topNeeds.length) {
      setFeedbackTopNeedsError('Select at least one priority.');
      const firstTopNeed = feedbackForm?.querySelector('input[name="top_needs"]');
      firstTopNeed?.focus();
      return false;
    }

    return true;
  }

  function extractLeadId(result) {
    const raw =
      result?.lead_id ??
      result?.leadId ??
      result?.id ??
      result?.data?.lead_id ??
      result?.data?.leadId ??
      result?.data?.id ??
      result?.lead?.id ??
      null;

    if (raw === null || raw === undefined || raw === '') {
      return null;
    }

    return raw;
  }

  async function postJson(path, payload) {
    activeController = new AbortController();

    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: activeController.signal,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    activeController = null;

    const accepted = response.ok || Boolean(data?.existing);

    if (!accepted) {
      const error = new Error(data?.message || data?.error || data?.detail || 'Something went wrong.');
      error.status = response.status;
      error.details = data?.errors || null;
      throw error;
    }

    return data;
  }

  async function onRequestSubmit(event) {
    event.preventDefault();

    if (requestSubmitting) return;
    if (!validateRequestForm()) return;

    setRequestSubmittingState(true);
    setRequestFormMessage('');

    const urlParams = new URLSearchParams(window.location.search);

const payload = {
  product: 'klaedon',
  email: emailInput?.value.trim() || '',
  role: roleInput?.value || '',
  consent: Boolean(consentInput?.checked),
  honeypot: honeypotInput?.value.trim() || '',
  referrer: document.referrer || window.location.href,
  utm_source: urlParams.get('utm_source') || '',
  utm_medium: urlParams.get('utm_medium') || '',
  utm_campaign: urlParams.get('utm_campaign') || '',
  utm_term: urlParams.get('utm_term') || '',
  utm_content: urlParams.get('utm_content') || '',
};

    try {
      const result = await postJson('/api/waitlist', payload);
      setRequestSubmittingState(false);

      const leadId = extractLeadId(result);
      console.log('waitlist response:', result, 'resolved leadId:', leadId);

      if (!leadId) {
        renderRequestSuccess('Request received. Feedback step is blocked because the backend did not return a lead id.');
        setRequestFormMessage('Backend response missing lead_id.', 'error');
        return;
      }

      hideRequestModal({ restoreFocus: false, reset: false, unlock: false });
      showFeedbackModal(leadId);
    } catch (error) {
      if (error?.name === 'AbortError') return;

      setRequestSubmittingState(false);

      if (error?.details?.email) {
        setEmailError(error.details.email);
        emailInput?.focus();
        return;
      }

      if (error?.details?.consent) {
        setConsentError(error.details.consent);
        consentInput?.focus();
        return;
      }

      setRequestFormMessage(error?.message || 'Could not connect to server.', 'error');
    }
  }

  async function onFeedbackSubmit(event) {
    event.preventDefault();

    if (feedbackSubmitting) return;
    if (!validateFeedbackForm()) return;

    setFeedbackSubmittingState(true);
    setFeedbackFormMessage('');

    const payload = {
      lead_id: feedbackLeadIdInput?.value.trim() || '',
      top_needs: getSelectedTopNeeds(),
      delivery_preference: getSelectedRadioValue('delivery_preference') || 'email',
      price_expectation: getSelectedRadioValue('price_expectation') || '0-199',
      free_text: feedbackFreeTextInput?.value.trim() || '',
    };

    try {
      await postJson('/api/waitlist/feedback', payload);
      setFeedbackSubmittingState(false);
      renderFeedbackSuccess('Thanks. This tells us what to build next.');

      window.setTimeout(() => {
        hideFeedbackModal({ restoreFocus: true, reset: true });
        resetRequestState();
      }, 900);
    } catch (error) {
      if (error?.name === 'AbortError') return;

      setFeedbackSubmittingState(false);

      if (error?.details?.top_needs) {
        setFeedbackTopNeedsError(error.details.top_needs);
        return;
      }

      setFeedbackFormMessage(error?.message || 'Could not save feedback.', 'error');
    }
  }

  function onKeydown(event) {
    if (!activeModal) return;

    if (event.key === 'Escape') {
      if (activeModal === 'feedback') {
        hideFeedbackModal({ restoreFocus: true, reset: true });
        resetRequestState();
      } else {
        hideRequestModal({ restoreFocus: true, reset: true });
      }
      return;
    }

    if (event.key !== 'Tab') return;

    const activePanel = getActivePanel();
    const focusable = getFocusableElements(activePanel);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (activeElement === first || !activePanel.contains(activeElement)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function clearRequestFieldErrors() {
    const email = emailInput?.value.trim() || '';

    if (email && isValidEmail(email)) setEmailError('');
  }

  function clearFeedbackTopNeedsError() {
    if (getSelectedTopNeeds().length) {
      setFeedbackTopNeedsError('');
    }
  }

  function onRequestClose() {
    hideRequestModal({ restoreFocus: true, reset: true });
  }

  function onFeedbackClose() {
    hideFeedbackModal({ restoreFocus: true, reset: true });
    resetRequestState();
  }

  function onFeedbackSkip() {
    hideFeedbackModal({ restoreFocus: true, reset: true });
    resetRequestState();
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', openRequestModal);
  });

  requestCloseButton?.addEventListener('click', onRequestClose);
  requestBackdrop?.addEventListener('click', onRequestClose);
  feedbackCloseButton?.addEventListener('click', onFeedbackClose);
  feedbackBackdrop?.addEventListener('click', onFeedbackClose);

  requestForm?.addEventListener('submit', onRequestSubmit);
  feedbackForm?.addEventListener('submit', onFeedbackSubmit);
  feedbackSkipButton?.addEventListener('click', onFeedbackSkip);

  emailInput?.addEventListener('input', clearRequestFieldErrors);
  consentInput?.addEventListener('change', () => {
    if (consentInput?.checked) setConsentError('');
  });

  feedbackForm?.querySelectorAll('input[name="top_needs"]').forEach((input) => {
    input.addEventListener('change', clearFeedbackTopNeedsError);
  });

  document.addEventListener('keydown', onKeydown);

  return function cleanupValidationFlow() {
    triggers.forEach((trigger) => {
      trigger.removeEventListener('click', openRequestModal);
    });

    requestCloseButton?.removeEventListener('click', onRequestClose);
    requestBackdrop?.removeEventListener('click', onRequestClose);
    feedbackCloseButton?.removeEventListener('click', onFeedbackClose);
    feedbackBackdrop?.removeEventListener('click', onFeedbackClose);

    requestForm?.removeEventListener('submit', onRequestSubmit);
    feedbackForm?.removeEventListener('submit', onFeedbackSubmit);
    feedbackSkipButton?.removeEventListener('click', onFeedbackSkip);

    emailInput?.removeEventListener('input', clearRequestFieldErrors);
    document.removeEventListener('keydown', onKeydown);

    feedbackForm?.querySelectorAll('input[name="top_needs"]').forEach((input) => {
      input.removeEventListener('change', clearFeedbackTopNeedsError);
    });

    abortActiveRequest();
    activeModal = null;
    unlockScroll();
  };
}

function setup() {
  if (_cleanup) {
    _cleanup();
    _cleanup = null;
  }

  const cleanupReveal = initReveal();
  const cleanupFlowField = initFlowField();
  const cleanupUnfilteredCanvas = initUnfilteredCanvas();
  const cleanupValidationFlow = initValidationFlow();

  _cleanup = function cleanup() {
    if (cleanupReveal) cleanupReveal();
    if (cleanupFlowField) cleanupFlowField();
    if (cleanupUnfilteredCanvas) cleanupUnfilteredCanvas();
    if (cleanupValidationFlow) cleanupValidationFlow();
    _cleanup = null;
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup, { once: true });
} else {
  setup();
}