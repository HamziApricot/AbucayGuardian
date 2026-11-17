/**
 * Phone number and OTP formatting helpers.
 */

/**
 * Normalizes any phone number input into standard E.164 format (+639XXXXXXXXX or international).
 * Handles inputs with or without country code, with leading 0, spaces, dashes, or parentheses.
 */
export function normalizePhoneNumber(phone: string, defaultCountry: string = '+63'): string {
    if (!phone) return '';
    let cleaned = phone.trim().replace(/[^\d+]/g, '');

    // If it already starts with '+', keep it as valid E.164
    if (cleaned.startsWith('+')) {
        return cleaned;
    }

    const countryDigits = defaultCountry.replace(/\D/g, '');

    // If input already starts with the country code digits (e.g. 63917...)
    if (cleaned.startsWith(countryDigits)) {
        return '+' + cleaned;
    }

    // If it starts with leading zero (e.g. 0917...)
    if (cleaned.startsWith('0')) {
        cleaned = cleaned.replace(/^0+/, '');
    }

    const prefix = defaultCountry.startsWith('+') ? defaultCountry : '+' + defaultCountry;
    return prefix + cleaned;
}

/**
 * Strips all non-digit characters from an OTP token and extracts the 6 digits.
 * Prevents issues where SMS auto-fill or copy-paste includes spaces, dashes, or dots.
 */
export function cleanOtpCode(token: string): string {
    if (!token) return '';
    return token.replace(/\D/g, '').slice(0, 6);
}
