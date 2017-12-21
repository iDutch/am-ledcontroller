AUTOBAHN_DEBUG = true;
const autobahn = require('autobahn');
const wpi = require('wiringpi-node');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const pins = {
    "redPin": 2,
    "greenPin": 0,
    "bluePin": 7,
    "warmwhitePin": 4,
    "coldwhitePin": 5
};

var pinvaulues = {
    "redPin": 0,
    "greenPin": 0,
    "bluePin": 0,
    "warmwhitePin": 0,
    "coldwhitePin": 0
};

wpi.setup('wpi');

wpi.pinMode(pins.redPin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.greenPin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.bluePin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.warmwhitePin, wpi.SOFT_PWM_OUTPUT);
wpi.pinMode(pins.coldwhitePin, wpi.SOFT_PWM_OUTPUT);

wpi.softPwmWrite(pins.redPin, 0);
wpi.softPwmWrite(pins.greenPin, 0);
wpi.softPwmWrite(pins.bluePin, 0);
wpi.softPwmWrite(pins.warmwhitePin, 0);
wpi.softPwmWrite(pins.coldwhitePin, 0);

console.log(process.env);
var user = process.env.CLIENT_USER;
var key = process.env.CLIENT_KEY;
var schedule = null;

function onchallenge (session, method, extra) {
    console.log("onchallenge", method, extra);
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(key, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
}

function loadSchedule() {
    axios.get('https://hoogstraaten.eu/schedule.json')
        .then(function(response) {
            //console.log(response.data);
            schedule = response.data;
            fs.writeFile("/etc/systemd/system/RGBController/schedule.json", JSON.stringify(response.data), function(err) {
                if(err) {
                    return console.log(err);
                }
                console.log("The file was saved!");
            });
            calculateSchedule(schedule, moment());
            scheduleInterval = setInterval(function () {
                calculateSchedule(schedule, moment());
            }, 60000);
        })
        .catch(function (error) {
            fs.readFile('/etc/systemd/system/RGBController/schedule.json', 'utf8', function (err,data) {
                if (err) {
                    return console.log(err);
                }
                schedule = JSON.parse(data);
                calculateSchedule(schedule, moment());
                scheduleInterval = setInterval(function () {
                    calculateSchedule(schedule, moment());
                }, 60000);
            });
        });
}

/**
 * Calculate the interpolation of loaded schedule
 *
 * @param schedule
 * @param currenttime
 */
function calculateSchedule(schedule, currenttime) {
    var max = schedule.length - 1;
    for (var index in schedule) {
        var index2 = parseInt(index) + 1;
        var first = moment(schedule[index].time, 'HH:mm');
        //If last index then compare it with the first one
        if (index == max) {
            index2 = 0;
            var second = moment(schedule[index2].time, 'HH:mm').add(1, 'days');
        } else {
            var second = moment(schedule[index2].time, 'HH:mm');
        }
        //Get the two schedule entries where the current time is in between.
        if(currenttime.isBetween(first, second, 'minutes', '[)')){
            //Determine maxdiff and currentdiff to calculate the percentage
            //of how far the progression is between the two entries
            var maxdiff = second.diff(first, 'minutes');
            var currentdiff = currenttime.diff(first, 'minutes');
            var percentage = (currentdiff / maxdiff) * 100;
            //console.log(first, second, maxdiff, currentdiff, percentage, schedule[index2]);
            //Calculate PWM level for each channel based on difference between level values of the two entries
            //and percentage of the progress
            for (var i in schedule[index]) {
                if (i === 'time') {
                    continue;
                }
                if (parseInt(schedule[index][i]) !== parseInt(schedule[index2][i])) {
                    var powerdiff =  parseInt(schedule[index2][i]) - parseInt(schedule[index][i]);
                    var ledpower = parseInt(schedule[index][i]) + (Math.round(powerdiff * (percentage / 100)));
                    if(pinvaulues[i + 'Pin'] !== ledpower) {
                        wpi.softPwmWrite(pins[i + 'Pin'], ledpower);
                        pinvaulues[i + 'Pin'] = ledpower;
                    }
                } else {
                    if(pinvaulues[i + 'Pin'] !== parseInt(schedule[index2][i])) {
                        wpi.softPwmWrite(pins[i + 'Pin'], parseInt(schedule[index2][i]));
                        pinvaulues[i + 'Pin'] = parseInt(schedule[index2][i]);
                    }
                }
                console.log(schedule[index][i], ledpower, currenttime);
            }
        }
    }
}

var scheduleInterval, cycleInterval = null;

var connection = new autobahn.Connection({
    url: 'wss://cb.hoogstraaten.eu/ws',
    realm: 'eu.hoogstraaten.fishtank',
    authid: user,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = function (session) {
    console.log('Tada');
    // // 1) subscribe to a topic
    // function onevent(args) {
    //     console.log("Event:", args[0]);
    // }
    // session.subscribe('com.myapp.hello', onevent);
    //
    // // 2) publish an event
    // session.publish('com.myapp.hello', ['Hello, world!']);
    //
    // // 3) register a procedure for remoting
    // function add2(args) {
    //     return args[0] + args[1];
    // }
    // session.register('com.myapp.add2', add2);
    //
    // // 4) call a remote procedure
    // session.call('com.myapp.add2', [2, 3]).then(
    //     function (res) {
    //         console.log("Result:", res);
    //     }
    // );
};

connection.onclose = function (reason, details) {
    console.log("Connection lost:", reason, details);
}

//loadSchedule();
connection.open();
