// Shop-floor passcode for status changes. It is not shown in the app.

const STATUS_PASSCODE = '240'

export function passcodeMatches(value) {
  return String(value ?? '').trim() === STATUS_PASSCODE
}
