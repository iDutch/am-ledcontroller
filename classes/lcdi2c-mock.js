module.exports = class HD44780 {
    constructor(device, address, cols, rows) {
        this.device = device;
        this.address = address;
        this.cols = cols;
        this.rows = rows;
    };
    _pad(pad, str, padLeft) {
        if (typeof str === 'undefined')
            return pad;
        if (padLeft) {
            return (pad + str).slice(-pad.length);
        } else {
            return (str + pad).substring(0, pad.length);
        }
    };
    println(message, line) {
        message = this._pad(new Array(21).join(' '), message, false);
        console.log(message, line);
    };
    clear() {
        console.log('Cleared');
    }
};