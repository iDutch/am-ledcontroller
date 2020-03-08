const pigpio = process.env.NODE_ENV === "production" ? require("pigpio") : require("pigpio-mock");
const Gpio = pigpio.Gpio;
const moment = require('moment');
const fs = require('mz/fs');

const API = require('./API');
const Timer = require('./timer');

require('dotenv').config();

let Lights = class Lights {
    constructor(PWMClockSampleRate, PWMFrequency, PWMRange) {
        if (process.env.NODE_ENV === "production") {
            pigpio.configureClock(PWMClockSampleRate, pigpio.CLOCK_PCM);
        }
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

        if (process.env.NODE_ENV === "production") {
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
        }
        this.schedule = null;

        this.scheduleInterval = 0;
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
        process.send({channelValues: this.channelValues});
    };
    _clearInterval(interval) {
        if (interval instanceof Timer) {
            interval.clear();
        }
    };
    init() {
        this._clearChannels();

        //Load schedule from last known schedule's id
        fs.readFile(process.env.SCHEDULE_STORAGE_FILE, 'utf8').then(content => {
            this.schedule = JSON.parse(content);
            this.loadSchedule(this.schedule.data.id);
        }).catch(error => console.log(error));
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
                    //Determine maxdiff and current diff to calculate the percentage
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
            process.send({channelValues: this.channelValues});
        }
    };
    loadSchedule(id) {
        this._clearInterval(this.scheduleInterval);

        this.channelOverride.redLed = false;
        this.channelOverride.greenLed = false;
        this.channelOverride.blueLed = false;
        this.channelOverride.cwhiteLed = false;
        this.channelOverride.wwhiteLed = false;

        API.request('/api/schedule/' + id, 'get', null).then(data => {
            this.schedule = data;
            fs.writeFile(process.env.SCHEDULE_STORAGE_FILE, JSON.stringify(this.schedule), function(err) {
                if(err) {
                    return console.log(err);
                }
            });
            process.send({scheduleName: this.schedule.data.name});
            process.send({scheduleId: this.schedule.data.id});
            this._clearChannels();
            this.calculateLedValues(moment());
            this.scheduleInterval = new Timer(() => {
                this.calculateLedValues(moment());
            }, false, 1000);
        }).catch(error => {
            console.log(error);
            fs.readFile(process.env.SCHEDULE_STORAGE_FILE, 'utf8').then(content => {
                console.log(content);
                this.schedule = JSON.parse(content);
            }).catch(error => console.log(error));
            process.send({scheduleName: this.schedule.data.name});
            process.send({scheduleId: this.schedule.data.id});
            this._clearChannels();
            this.calculateLedValues(moment());
            this.scheduleInterval = new Timer(() => {
                this.calculateLedValues(moment());
            }, false, 1000);
        });
    };
};

module.exports = new Lights(process.env.PWM_CLOCK_SAMPLE_RATE, process.env.PWM_FREQUENCY, process.env.PWM_RANGE);
