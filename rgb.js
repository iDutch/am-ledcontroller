AUTOBAHN_DEBUG = false;
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

var user = process.env.CLIENT_USER;
var key = process.env.CLIENT_KEY;
var api_tokens = null;

const oauth_data = {
    "grant_type": process.env.USER_GRANT_TYPE,
    "client_id": process.env.CLIENT_ID,
    "client_secret": process.env.CLIENT_SECRET,
    "username": process.env.USER_EMAIL,
    "password": process.env.USER_PASSWORD,
    "scope": process.env.SCOPE_INT
};

/**
 * My very ugly API call wrapper
 *
 * @param url
 * @param method
 * @param data
 */
function api_call(url, method, data) {
    return new Promise(function(resolve, reject) {
        if (api_tokens === null) {
            axios.post(
                'https://hoogstraaten.eu/oauth/token', oauth_data, {
                    headers: {
                        'content-type': 'application/json'
                    }
                })
                .then(function (response) {
                    api_tokens = response.data;
                    api_tokens.renew_on = moment().add(response.data.expires_in, 'seconds');

                    axios({
                        method: method,
                        url: url,
                        data: data,
                        headers: {
                            'authorization': 'Bearer '.concat(api_tokens.access_token),
                            'content-type': 'application/json'
                        }
                    }).then(function (response) {
                        resolve(response.data);
                    }).catch(function (error) {
                        reject(error);
                    });
                })
                .catch(function (error) {
                    reject(error);
                });
        } else if (api_tokens.renew_on < moment()) {
            axios.post(
                'https://hoogstraaten.eu/oauth/token', {
                    "grant_type": 'refresh_token',
                    "refresh_token": api_tokens.refresh_token,
                    "client_id": process.env.CLIENT_ID,
                    "client_secret": process.env.CLIENT_SECRET,
                    "scope": process.env.SCOPE_INT
                },
                {
                    headers: {
                        'content-type': 'application/json'
                    }
                })
                .then(function (response) {
                    api_tokens = response;
                    api_tokens.renew_on = moment().add(response.expires_in, 'seconds');

                    axios({
                        method: method,
                        url: url,
                        data: data,
                        headers: {
                            'authorization': 'Bearer '.concat(api_tokens.access_token),
                            'content-type': 'application/json'
                        }
                    }).then(function (response) {
                        resolve(response.data);
                    }).catch(function (error) {
                        reject(error);
                    });
                })
                .catch(function (error) {
                    reject(error);
                });
        } else {
            axios({
                method: method,
                url: url,
                data: data,
                headers: {
                    'authorization': 'Bearer '.concat(api_tokens.access_token),
                    'content-type': 'application/json'
                }
            }).then(function (response) {
                resolve(response.data);
            }).catch(function (error) {
                reject(error);
            });
        }
    });
}

var scheduleInterval, clockInterval, cycleInterval, blinkInterval = null;
var schedule = null;

function onchallenge (session, method, extra) {
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(key, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
}

/**
 * Load schedule from API and save to a local file. Or read from local file if API is not available
 *
 * @param id
 */
function loadSchedule(id) {
    clearInterval(scheduleInterval);
    clearInterval(cycleInterval);
    clearInterval(blinkInterval);
    api_call('https://hoogstraaten.eu/api/schedule/' + id, 'get', null)
        .then(function (response) {
            schedule = response.data;
            fs.writeFile("/etc/systemd/system/RGBController/schedule.json", JSON.stringify(response.data), function(err) {
                if(err) {
                    return console.log(err);
                }
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
 * Cycle through schedule at given speed
 *
 * @param speed
 */
function cycleSchedule(speed) {
    clearInterval(scheduleInterval);
    var start = moment("00:00", "HH:mm");
    cycleInterval = setInterval(function () {
        calculateSchedule(schedule, start.add(1, 'minutes'));
    }, speed);
}

/**
 * Calculate the interpolation of loaded schedule and set LED values
 *
 * @param schedule
 * @param currenttime
 */
function calculateSchedule(schedule, currenttime) {
    clearInterval(blinkInterval);
    console.log(schedule.entries.length);
    if (schedule.entries.length > 1) {
        var max = schedule.entries.length - 1;
        for (var index in schedule.entries) {
            var index2 = parseInt(index) + 1;
            var first = moment(schedule.entries[index].time, 'HH:mm');
            //If last index then compare it with the first one
            if (index == max) {
                index2 = 0;
                var second = moment(schedule.entries[index2].time, 'HH:mm').add(1, 'days');
            } else {
                var second = moment(schedule.entries[index2].time, 'HH:mm');
            }
            //Get the two schedule entries where the current time is in between.
            if (currenttime.isBetween(first, second, 'minutes', '[)')) {
                //Determine maxdiff and currentdiff to calculate the percentage
                //of how far the progression is between the two entries
                var maxdiff = second.diff(first, 'minutes');
                var currentdiff = currenttime.diff(first, 'minutes');
                var percentage = (currentdiff / maxdiff) * 100;
                //console.log(first, second, maxdiff, currentdiff, percentage, schedule[index2]);
                //Calculate PWM level for each channel based on difference between level values of the two entries
                //and percentage of the progress
                for (var i in schedule.entries[index].colors) {
                    if (parseInt(schedule.entries[index].colors[i]) !== parseInt(schedule.entries[index2].colors[i])) {
                        var powerdiff = parseInt(schedule.entries[index2].colors[i]) - parseInt(schedule.entries[index].colors[i]);
                        var ledpower = parseInt(schedule.entries[index].colors[i]) + (Math.round(powerdiff * (percentage / 100)));
                        if (pinvaulues[i + 'Pin'] !== ledpower) {
                            wpi.softPwmWrite(pins[i + 'Pin'], ledpower);
                            pinvaulues[i + 'Pin'] = ledpower;
                        }
                    } else {
                        if (pinvaulues[i + 'Pin'] !== parseInt(schedule.entries[index2].colors[i])) {
                            wpi.softPwmWrite(pins[i + 'Pin'], parseInt(schedule.entries[index2].colors[i]));
                            pinvaulues[i + 'Pin'] = parseInt(schedule.entries[index2].colors[i]);
                        }
                    }
                }
            }
        }
    } else if (schedule.entries.length === 1) {
        clearInterval(blinkInterval);
        for (var i in schedule.entries[0].colors) {
            if(pinvaulues[i + 'Pin'] !== parseInt(schedule.entries[0].colors[i])) {
                wpi.softPwmWrite(pins[i + 'Pin'], parseInt(schedule.entries[0].colors[i]));
                pinvaulues[i + 'Pin'] = parseInt(schedule.entries[0].colors[i]);
            }
        }
    } else {
        var value = 0;
        blinkInterval = setInterval(function () {
            value = !value ? 100 : 0;
            console.log(value);
            colors = {red: 0, green: 0, blue: 0};
            for (var i in colors) {
                wpi.softPwmWrite(pins[i + 'Pin'], value);
            }
        }, 500);
    }
}

//Define crossbar stuff
var connection = new autobahn.Connection({
    url: 'wss://cb.hoogstraaten.eu/ws',
    realm: 'eu.hoogstraaten.fishtank',
    authid: user,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = function (session) {

    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        var data = args[0];
        //If updated schedule has the same id as our loaded schedule then retreive it's updated content from the API
        if(schedule.id === data.schedule_id) {
            loadSchedule(data.schedule_id);
        }

    }
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        loadSchedule(args[0]);
    }
    session.register('eu.hoogstraaten.fishtank.setschedule.' + session.id, setSchedule);

    //Register procedure for getting the loaded schedule's id
    session.register('eu.hoogstraaten.fishtank.getactivescheduleid.' + session.id, function () {
        return schedule.id;
    });

    //Register procedure for cycleing through loaded schedule
    function cycle(args) {
        cycleSchedule(args[0]);
    }
    session.register('eu.hoogstraaten.fishtank.cycleschedule.' + session.id, cycle)

    //Publish device time
    clockInterval = setInterval(function () {
        session.publish('eu.hoogstraaten.fishtank.time.' + session.id, [moment()]);
    }, 1000);

    console.log('Client connected to cb.hoogstraaten.eu!');
};

connection.onclose = function (reason, details) {
    console.log("Connection lost:", reason, details);
}

//Load schedule from last known schedule's id
fs.readFile('/etc/systemd/system/RGBController/schedule.json', 'utf8', function (err,data) {
    if (err) {
        return console.log(err);
    }
    schedule = JSON.parse(data);
    loadSchedule(schedule.id);
});

//Start crossbar
connection.open();
