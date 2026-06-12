export function validateAddress(value) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
        throw new Error(`Invalid address: ${value}`);
    }
    return value;
}
export function validatePrivateKey(value) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
        throw new Error("Invalid private key format");
    }
    return value;
}
export function validatePositiveNumber(value, name) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
        throw new Error(`${name} must be a positive number`);
    }
    return num;
}
export function validatePositiveInteger(value, name) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return num;
}
export function validateSide(value) {
    const lower = value.toLowerCase();
    if (lower !== "buy" && lower !== "sell") {
        throw new Error('Side must be "buy" or "sell"');
    }
    return lower;
}
export function validateTif(value) {
    const mapping = {
        gtc: "Gtc",
        ioc: "Ioc",
        alo: "Alo",
    };
    const result = mapping[value.toLowerCase()];
    if (!result) {
        throw new Error('Time-in-force must be "Gtc", "Ioc", or "Alo"');
    }
    return result;
}
