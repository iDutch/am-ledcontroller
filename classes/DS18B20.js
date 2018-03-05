const fs = require('mz/fs');
const Timer = require('./timer');

require('dotenv').config();

let DS18B20 = class DS18B20 {
    constructor() {
        this.W1_FILE = '/sys/bus/w1/devices/w1_bus_master1/w1_master_slaves';
        this.parsers = {
            'hex': this._parseHexData,
            'decimal': this._parseDecimalData,
            'default': this._parseDecimalData
        };

        this.temperatureData = [];
    };
    init() {
        this.sensors((err, sensors) => {
            if (err) {
                return console.error(err);
            }

            if (sensors.length) {
                new Timer(() => {
                    for (let index in sensors) {
                        this.temperature(sensors[index], (err, value) => {
                            if (err) {
                                console.error(err);
                            }
                            this.temperatureData[index] = value;
                        });
                    }
                    process.send({temperature: this.temperatureData});
                }, 1000);
                new Timer(() => {
                    process.send({sendtemperature: this.temperatureData});
                }, 60000);
            } else {
                process.send({error: 'No Sensor!'});
            }
        });
    };
    _parseHexData(data) {
        let arr = data.split(' ');

        if (arr[1].charAt(0) === 'f') {
            let x = parseInt('0xffff' + arr[1].toString() + arr[0].toString(), 16);
            return (-((~x + 1) * 0.0625));
        } else if (arr[1].charAt(0) === '0') {
            return parseInt('0x0000' + arr[1].toString() + arr[0].toString(), 16) * 0.0625;
        }
        throw new Error('Can not parse data');
    };

    _parseDecimalData(data) {
        let arr = data.split('\n');

        if (arr[0].indexOf('YES') > -1) {
            var output = data.match(/t=(-?(\d+))/);
            return Math.round(output[1] / 100) / 10;
        } else if (arr[0].indexOf('NO') > -1) {
            return false;
        }
        throw new Error('Can not get temperature');
    };

    _parseData(data, options) {
        let parser = options.parser || 'default';
        if (!this.parsers[parser]) {
            parser = 'default';
        }
        return this.parsers[parser](data);
    };
    // Get all connected sensor IDs as array
    // @param callback(err, array)
    sensors(callback) {
        fs.readFile(this.W1_FILE, 'utf8', function(err, data) {
            if (err) {
                return callback(err);
            }

            let parts = data.split('\n');
            parts.pop();

            let regex = /^28-.*/;
            let sensors = [];
            for (let index in parts) {
                if (regex.test(parts[index])) {
                    sensors.push(parts[index]);
                }
            }
            return callback(null, sensors);
        });
    };
    // Get the temperature of a given sensor
    // @param sensor : The sensor ID
    // @param callback : callback (err, value)
    temperature(sensor, options, callback) {
        if (options instanceof Function) {
            callback = options;
            options = {};
        }

        fs.readFile('/sys/bus/w1/devices/w1_bus_master1/' + sensor + '/w1_slave', 'utf8', (err, data) => {
            if (err) {
                return callback(err);
            }

            try {
                return callback(null, this._parseData(data, options));
            } catch(e) {
                return callback(new Error('Can not read temperature for sensor ' + sensor));
            }
        });
    };
    temperatureSync(sensor, options) {
        options = options || {};
        let data = fs.readFileSync('/sys/bus/w1/devices/w1_bus_master1/' + sensor + '/w1_slave', 'utf8');
        return this._parseData(data, options);
    };
};

module.exports = new DS18B20();
