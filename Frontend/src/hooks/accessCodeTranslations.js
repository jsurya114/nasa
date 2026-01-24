// hooks/accessCodeTranslations.js
// Translation utility for dynamic access code content

/**
 * Bidirectional translation dictionary for common access code phrases.
 * Each entry maps English phrase to Spanish translation.
 */
const accessCodeDictionary = {
    // ============ DELIVERY INSTRUCTIONS ============
    'deliver to front desk': 'entregar en recepción',
    'deliver to door': 'entregar en puerta',
    'deliver to office': 'entregar en oficina',
    'deliver to leasing': 'entregar en arrendamiento',
    'deliver to lobby': 'entregar en vestíbulo',
    'deliver to mailroom': 'entregar en sala de correo',
    'deliver to mail room': 'entregar en sala de correo',
    'deliver to concierge': 'entregar en conserjería',
    'deliver to guard': 'entregar al guardia',
    'deliver to security': 'entregar a seguridad',
    'deliver to': 'entregar en',
    'deliver': 'entregar',

    // ============ LOCKERS ============
    'lockers thru leasing': 'casilleros a través de arrendamiento',
    'locker thru leasing': 'casillero a través de arrendamiento',
    'lockers through leasing': 'casilleros a través de arrendamiento',
    'locker through leasing': 'casillero a través de arrendamiento',
    'lockers in mail room': 'casilleros en sala de correo',
    'lockers in mailroom': 'casilleros en sala de correo',
    'locker in mail room': 'casillero en sala de correo',
    'lockers': 'casilleros',
    'locker': 'casillero',

    // ============ ACCESS/ENTRY ============
    'access thru leasing': 'acceso a través de arrendamiento',
    'access through leasing': 'acceso a través de arrendamiento',
    'acceso thru leasing': 'acceso a través de arrendamiento',
    'thru leasing': 'a través de arrendamiento',
    'through leasing': 'a través de arrendamiento',
    'thru office': 'a través de oficina',
    'through office': 'a través de oficina',
    'thru': 'a través de',
    'through': 'a través de',

    // ============ FRONT DESK / RECEPTION ============
    'front desk': 'recepción',
    'front office': 'oficina principal',
    'reception desk': 'recepción',
    'reception': 'recepción',
    'concierge': 'conserjería',

    // ============ LEASING ============
    'leasing office': 'oficina de arrendamiento',
    'leasing': 'arrendamiento',

    // ============ ELEVATOR ============
    'use elevator': 'usar ascensor',
    'take elevator': 'tomar ascensor',
    'elevator': 'ascensor',
    'stairs': 'escaleras',

    // ============ FOB/KEY ============
    'key fob': 'llavero',
    'fob for elevator': 'llavero para ascensor',
    'fob': 'llavero',
    'key card': 'tarjeta llave',
    'keycard': 'tarjeta llave',
    'key': 'llave',

    // ============ GET/OBTAIN ============
    'get fob from': 'obtener llavero de',
    'get key from': 'obtener llave de',
    'get from': 'obtener de',
    'get': 'obtener',

    // ============ NEED ============
    'need fob': 'necesita llavero',
    'need key': 'necesita llave',
    'need access': 'necesita acceso',
    'need to call': 'necesita llamar',
    'need': 'necesita',

    // ============ ACROSS/STREET ============
    'across the street from': 'al otro lado de la calle de',
    'across the street': 'al otro lado de la calle',
    'across from': 'enfrente de',
    'across': 'al otro lado',
    'street': 'calle',

    // ============ MAIL ============
    'mail room': 'sala de correo',
    'mailroom': 'sala de correo',
    'mail on elevator': 'correo en ascensor',
    'mailbox': 'buzón',
    'mail': 'correo',

    // ============ COMMON INSTRUCTIONS ============
    'call tenant': 'llamar al inquilino',
    'call office': 'llamar a oficina',
    'call leasing': 'llamar a arrendamiento',
    'call for access': 'llamar para acceso',
    'call': 'llamar',
    'ring bell': 'tocar el timbre',
    'ring doorbell': 'tocar el timbre',
    'ring': 'tocar',
    'leave at door': 'dejar en la puerta',
    'leave at front door': 'dejar en la puerta principal',
    'leave at back door': 'dejar en la puerta trasera',
    'leave package': 'dejar paquete',
    'leave with neighbor': 'dejar con vecino',
    'leave with': 'dejar con',
    'leave at': 'dejar en',
    'leave': 'dejar',
    'do not leave': 'no dejar',
    'knock on door': 'tocar la puerta',
    'knock': 'tocar',

    // ============ GATE/DOOR ============
    'gate code': 'código de puerta',
    'door code': 'código de puerta',
    'front gate': 'puerta principal',
    'back gate': 'puerta trasera',
    'side gate': 'puerta lateral',
    'main gate': 'puerta principal',
    'front door': 'puerta principal',
    'back door': 'puerta trasera',
    'side door': 'puerta lateral',
    'gate': 'puerta',
    'door': 'puerta',

    // ============ LOCATIONS ============
    'office': 'oficina',
    'lobby': 'vestíbulo',
    'apartment': 'apartamento',
    'apt': 'apto',
    'unit': 'unidad',
    'building': 'edificio',
    'floor': 'piso',
    'basement': 'sótano',
    'garage': 'garaje',
    'parking': 'estacionamiento',
    'porch': 'porche',
    'steps': 'escalones',
    'room': 'sala',

    // ============ ACTIONS ============
    'press': 'presionar',
    'enter code': 'ingresar código',
    'enter': 'ingresar',
    'type': 'escribir',
    'dial': 'marcar',
    'wait': 'esperar',
    'push': 'empujar',
    'pull': 'jalar',
    'use': 'usar',
    'take': 'tomar',
    'go to': 'ir a',

    // ============ COMMON WORDS ============
    'code': 'código',
    'access': 'acceso',
    'keypad': 'teclado',
    'buzzer': 'timbre',
    'intercom': 'intercomunicador',
    'security': 'seguridad',
    'guard': 'guardia',
    'manager': 'administrador',
    'resident': 'residente',
    'tenant': 'inquilino',
    'owner': 'propietario',
    'package': 'paquete',
    'packages': 'paquetes',
    'parcel': 'paquete',

    // ============ TIME ============
    'after': 'después de',
    'before': 'antes de',
    'morning': 'mañana',
    'afternoon': 'tarde',
    'evening': 'noche',

    // ============ DIRECTIONS ============
    'left': 'izquierda',
    'right': 'derecha',
    'straight': 'recto',
    'behind': 'detrás',
    'next to': 'al lado de',
    'in front of': 'enfrente de',
    'from': 'de',
    'to': 'a',
    'on': 'en',
    'at': 'en',
    'for': 'para',

    // ============ STATUS ============
    'open': 'abierto',
    'closed': 'cerrado',
    'locked': 'cerrado con llave',
    'unlocked': 'desbloqueado',

    // ============ COMMON PHRASES ============
    'no access code': 'sin código de acceso',
    'none': 'ninguno',
    'n/a': 'n/a',
    'not applicable': 'no aplica',
    'see notes': 'ver notas',
    'ask for': 'preguntar por',
    'contact': 'contactar',
};

/**
 * Build reverse dictionary (Spanish to English)
 */
const reverseDictionary = {};
Object.entries(accessCodeDictionary).forEach(([en, es]) => {
    reverseDictionary[es] = en;
});

/**
 * Escape special regex characters in a string
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Translate an access code text based on the target language.
 * 
 * @param {string} accessCodeText - The original access code text
 * @param {string} targetLanguage - Target language ('en' or 'es')
 * @returns {string} - Translated access code text
 */
export const translateAccessCode = (accessCodeText, targetLanguage = 'en') => {
    if (!accessCodeText || typeof accessCodeText !== 'string') {
        return accessCodeText || '';
    }

    let result = accessCodeText;

    if (targetLanguage === 'es') {
        // Translate from English to Spanish
        // Sort by length (longest first) to match longer phrases before shorter ones
        const sortedEntries = Object.entries(accessCodeDictionary)
            .sort((a, b) => b[0].length - a[0].length);

        for (const [english, spanish] of sortedEntries) {
            // Case-insensitive replacement with word boundaries
            const regex = new RegExp(`\\b${escapeRegex(english)}\\b`, 'gi');
            result = result.replace(regex, (match) => {
                // Preserve original casing pattern
                if (match === match.toUpperCase()) {
                    return spanish.toUpperCase();
                } else if (match[0] === match[0].toUpperCase()) {
                    return spanish.charAt(0).toUpperCase() + spanish.slice(1);
                }
                return spanish;
            });
        }
    } else if (targetLanguage === 'en') {
        // Translate from Spanish to English
        const sortedEntries = Object.entries(reverseDictionary)
            .sort((a, b) => b[0].length - a[0].length);

        for (const [spanish, english] of sortedEntries) {
            const regex = new RegExp(`\\b${escapeRegex(spanish)}\\b`, 'gi');
            result = result.replace(regex, (match) => {
                // Preserve original casing pattern
                if (match === match.toUpperCase()) {
                    return english.toUpperCase();
                } else if (match[0] === match[0].toUpperCase()) {
                    return english.charAt(0).toUpperCase() + english.slice(1);
                }
                return english;
            });
        }
    }

    return result;
};

export default translateAccessCode;
