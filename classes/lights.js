const pigpio = require('pigpio');
const Gpio = pigpio.Gpio;
const moment = require('moment');
const fs = require('mz/fs');

const API = require('./API');
const HD44780 = require('./HD44780');
const Timer = require('./timer');

require('dotenv').config();

let Lights = class Lights {
    constructor(PWMClockSampleRate, PWMFrequency, PWMRange) {
        pigpio.configureClock(PWMClockSampleRate, pigpio.CLOCK_PCM);

        this.LCD = new HD44780(1, 0x3f, 20, 4);

        this.channels = {
            redLed: new Gpio(26, {mode: Gpio.OUTPUT}),
            greenLed: new Gpio(19, {mode: Gpio.OUTPUT}),
            blueLed: new Gpio(13, {mode: Gpio.OUTPUT}),
            wwhiteLed: new Gpio(6, {mode: Gpio.OUTPUT}),
            cwhiteLed: new Gpio(5, {mode: Gpio.OUTPUT}),
        };
        this.channelValues = {
            redLed: 0,
            greenLed: 0,
            blueLed: 0,
            wwhiteLed: 0,
            cwhiteLed: 0
        };
        this.channelOverride = {
            redLed: false,
            greenLed: false,
            blueLed: false,
            wwhiteLed: false,
            cwhiteLed: false
        };

        this.channels.redLed.pwmRange(PWMRange);
        this.channels.greenLed.pwmRange(PWMRange);
        this.channels.blueLed.pwmRange(PWMRange);
        this.channels.wwhiteLed.pwmRange(PWMRange);
        this.channels.cwhiteLed.pwmRange(PWMRange);

        this.channels.redLed.pwmFrequency(PWMFrequency);
        this.channels.greenLed.pwmFrequency(PWMFrequency);
        this.channels.blueLed.pwmFrequency(PWMFrequency);
        this.channels.wwhiteLed.pwmFrequency(PWMFrequency);
        this.channels.cwhiteLed.pwmFrequency(PWMFrequency);

        this.schedule = null;
        this.crossbarsession = null;

        this.scheduleInterval = 0;
        this.clockInterval = 0;
        this.cycleInterval = 0;
    };
    _clearChannels() {
        this.channels.redLed.digitalWrite(0);
        this.channels.greenLed.digitalWrite(0);
        this.channels.blueLed.digitalWrite(0);
        this.channels.wwhiteLed.digitalWrite(0);
        this.channels.cwhiteLed.digitalWrite(0);

        this.channelValues.redLed = 0;
        this.channelValues.greenLed = 0;
        this.channelValues.blueLed = 0;
        this.channelValues.wwhiteLed = 0;
        this.channelValues.cwhiteLed = 0;
        if (this.crossbarsession !== null) {
            this.crossbarsession.publish('eu.hoogstraaten.fishtank.channelvalues.' + this.crossbarsession.id, [this.channelValues]);
        }
    };
    _clearInterval(interval) {
        if (interval instanceof Timer) {
            interval.clear();
        }
    };
    init() {
        this._clearChannels();
        this.LCD.lcd.clear();
        this.LCD.print(process.env.CLIENT_USER, 1);

        //Load schedule from last known schedule's id
        fs.readFile('/opt/fishtank/schedule.json', 'utf8').then(content => {
            this.schedule = JSON.parse(content);
            this.loadSchedule(this.schedule.data.id);
        }).catch(error => console.log(error));

        this.LCD.print('Time: ' + moment().format('HH:mm:ss'), 4);
        this.clockInterval = new Timer(() => {
            this.LCD.print('Time: ' + moment().format('HH:mm:ss'), 4);
            if (null !== this.crossbarsession) {
                this.crossbarsession.publish('eu.hoogstraaten.fishtank.time.' + this.crossbarsession.id, [moment()]);
            }
        }, 1000);
    };
    calculateLedValues(time) {
        if (this.schedule.data.entries.length > 1) {
            let max = this.schedule.data.entries.length - 1;
            for (let x in this.schedule.data.entries) {
                let index = parseInt(x);
                let index2 = index + 1;
                let firstentry = moment(this.schedule.data.entries[index].time, 'HH:mm');
                let secondentry = null;
                //If last index then compare it with the first one
                if (index === max) {
                    index2 = 0;
                    secondentry = moment(this.schedule.data.entries[index2].time, 'HH:mm').add(1, 'days');
                } else {
                    secondentry = moment(this.schedule.data.entries[index2].time, 'HH:mm');
                }
                //Get the two schedule entries where the current time is in between.
                if (time.isBetween(firstentry, secondentry, 'minutes', '[)')) {
                    //Determine maxdiff and currentdiff to calculate the percentage
                    //of how far the progression is between the two entries
                    let maxdiff = secondentry.diff(firstentry, 'seconds');
                    let diff = time.diff(firstentry, 'seconds');
                    let percentage = (diff / maxdiff) * 100;
                    //console.log(firstentry, secondentry, maxdiff, diff, percentage);
                    //Calculate PWM level for each channel based on difference between level values of the two entries
                    //and percentage of the progress
                    for (let i in this.schedule.data.entries[index].colors) {
                        //console.log(i, parseInt(this.schedule.data.entries[index].colors[i]) !== parseInt(this.schedule.data.entries[index2].colors[i]));
                        if (parseInt(this.schedule.data.entries[index].colors[i]) !== parseInt(this.schedule.data.entries[index2].colors[i])) {
                            let powerdiff = parseInt(this.schedule.data.entries[index2].colors[i]) - parseInt(this.schedule.data.entries[index].colors[i]);
                            let ledpower = parseInt(this.schedule.data.entries[index].colors[i]) + (Math.round(powerdiff * (percentage / 100)));
                            if (false === this.channelOverride[i + 'Led']) {
                                this.setLedValue(i, ledpower);
                            }
                        } else {
                            if (false === this.channelOverride[i + 'Led']) {
                                this.setLedValue(i, parseInt(this.schedule.data.entries[index2].colors[i]));
                            }
                        }
                    }
                }
            }
        } else if (this.schedule.data.entries.length === 1) {
            for (let i in this.schedule.data.entries[0].colors) {
                if (false === this.channelOverride[i + 'Led']) {
                    this.setLedValue(i, parseInt(this.schedule.data.entries[0].colors[i]));
                }
            }
        } else {

        }
    };
    setLedValue(color, value) {
        let val = parseInt(value);
        if (this.channelValues[color + 'Led'] !== val) {
            this.channels[color + 'Led'].pwmWrite(val);
            this.channelValues[color + 'Led'] = val;
            if (this.crossbarsession !== null) {
                this.crossbarsession.publish('eu.hoogstraaten.fishtank.channelvalues.' + this.crossbarsession.id, [this.channelValues]);
            }
        }
    };
    loadSchedule(id) {
        this._clearInterval(this.scheduleInterval);
        this._clearInterval(this.cycleInterval);

        API.request('https://hoogstraaten.eu/api/schedule/' + id, 'get', null).then(data => {
            this.schedule = data;
            fs.writeFile("/opt/fishtank/schedule.json", JSON.stringify(this.schedule), function(err) {
                if(err) {
                    return console.log(err);
                }
            });
            this.LCD.print('Schedule: ' + this.schedule.data.name, 2);
            this._clearChannels();

            this.calculateLedValues(moment());
            this.scheduleInterval = new Timer(() => {
                this.calculateLedValues(moment());
            }, 1000);
        }).catch(error => {
            console.log(error);
            fs.readFile('/opt/fishtank/schedule.json', 'utf8').then(content => {
                console.log(content);
                this.schedule = JSON.parse(content);
            }).catch(error => console.log(error));
            this.LCD.print('Schedule: ' + this.schedule.data.name, 2);
            this.calculateLedValues(moment());
            this.scheduleInterval = new Timer(() => {
                this.calculateLedValues(moment());
            }, 1000);
        });
    };
};

module.exports = new Lights(process.env.PWM_CLOCK_SAMPLE_RATE, process.env.PWM_FREQUENCY, process.env.PWM_RANGE);
