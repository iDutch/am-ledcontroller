module.exports = class MockLCD {
    constructor(device, address, cols, rows) {
        this.device = device;
        this.address = address;
        this.cols = cols;
        this.rows = rows;
    };
    println(message, line) {
        console.log(message, line, this.address);
    };
    clear() {
        console.log('Cleared');
    }
};