/**
 * Generates a 3-letter CODE from a name using consonants.
 * Algorithm:
 *   1. Extract consonants (non-vowel letters) from the name.
 *   2. If 3+ consonants exist → take the first 3, uppercase. (e.g. "Vakıfbank" → "VKF")
 *   3. If fewer than 3 consonants → take the first 3 characters of the name, uppercase.
 *      (e.g. "Ata" → "ATA", "Ali" → "ALI")
 */

const VOWELS = new Set(['a', 'e', 'ı', 'i', 'o', 'ö', 'u', 'ü'])

function isLetter(char) {
    return /[a-zA-ZçğışöüÇĞİŞÖÜ]/.test(char)
}

export function generateCode(name) {
    if (!name || !name.trim()) return ''

    const letters = name.split('').filter(isLetter)
    const consonants = letters.filter(c => !VOWELS.has(c.toLowerCase()))

    if (consonants.length >= 3) {
        return consonants.slice(0, 3).join('').toUpperCase()
    }

    return letters.slice(0, 3).join('').toUpperCase()
}
