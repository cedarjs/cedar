export function validateEmail(email: string) {
  return email.includes('@') &&
    email.includes('.') &&
    email.lastIndexOf('.') > email.indexOf('@') + 1
}
