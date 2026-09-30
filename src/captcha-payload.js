export function withCaptcha(body, captchaToken) {
  return captchaToken ? { ...body, gotrue_meta_security: { captcha_token: captchaToken } } : body
}
