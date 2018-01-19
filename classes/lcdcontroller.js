const LCD = require('lcdi2c');
module.exports = class LCDController {
    constructor(device, address, cols, rows) {
        this.lcd = new LCD(device, address, cols, rows);
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
    print(message, line){
        message = this._pad(new Array(21).join(' '), message, false);
        this.lcd.println(message, line);
    }
};
