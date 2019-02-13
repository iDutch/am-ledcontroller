const HD44780 = require('./HD44780');
const API = require('./API');
const moment = require('moment');
const { fork } = require('child_process');

module.exports = class Fishtank {
    constructor() {
        this.version = 'v0.2.2';

        this.scheduleId = null;
        this.scheduleName = null;
        this.channelValues = null;

        this.cbSession = null;

        this.LCD = [new HD44780(1, 0x3f, 20, 4), new HD44780(1, 0x3e, 20, 4)];
        this.LCD[0].clear();
        this.LCD[1].clear();
        this.LCD[0].print('AquaMotica ' + this.version, 1);

        this.lightsProcess = null;
        this.timeProcess = null;
        this.tempProcess = null;

        this.date = null;
        this.time = null;

        this.temp = null;

        this._startProcesses();
    };
    _startProcesses() {
        this.lightsProcess = fork('./processes/lights.js');
        this.lightsProcess.on('message', (msg) => {
            //console.log(msg);
            if (msg.scheduleId !== undefined) {
                this.scheduleId = msg.scheduleId;
            }
            if (msg.scheduleName !== undefined) {
                this.scheduleName = msg.scheduleName;
                this.LCD[1].print('Schedule: ' + msg.scheduleName, 1);
            }
            if (msg.channelValues !== undefined) {
                this.channelValues = msg.channelValues;
                if (this.cbSession !== null) {
                    this.cbSession.publish('eu.hoogstraaten.fishtank.channelvalues.' + this.cbSession.id, [msg.channelValues]);
                }
            }
        });
        this.timeProcess = fork('./processes/time.js');
        this.date = moment().format('DD/MM/YYYY');
        this.time = moment().format('HH:mm');
        this.LCD[0].print('Date: ' + this.date, 3);
        this.LCD[0].print('Time: ' + this.time, 4);
        this.timeProcess.on('message', (msg) => {
            if (msg.date !== undefined) {
                if (this.date !== msg.date) {
                    this.date = msg.date;
                    this.LCD[0].print('Date: ' + this.date, 3);
                }
            }
            if (msg.time !== undefined) {
                if (this.time !== msg.time) {
                    this.time = msg.time;
                    this.LCD[0].print('Time: ' + this.time, 4);
                }
            }
            if (this.cbSession !== null) {
                this.cbSession.publish('eu.hoogstraaten.fishtank.time.' + this.cbSession.id, [moment()]);
            }
        });
        this.tempProcess = fork('./processes/temp.js');
        this.tempProcess.on('message', (msg) => {
            if (msg.error !== undefined) {
                this.LCD[1].print('Temp: ' + msg.error, 4);
            }
            if (msg.printTemperature !== undefined && msg.temperature.constructor === Array) {
                let sum = msg.temperature.reduce((a, b) => a + b, 0);
                if (this.temp !== sum) {
                    this.temp = sum;
                    this.LCD[1].print('Temp: ' + this.temp + String.fromCharCode(223) + 'C', 4);
                }
            }
            if (msg.logTemperature !== undefined && msg.sendtemperature.constructor === Array) {
                let sum = msg.sendtemperature.reduce((a, b) => a + b, 0);
                API.request('/api/temperature', 'post', {"temperature": sum}).catch(error => {
                    return console.error(error);
                });
            }
        });
    }
};
