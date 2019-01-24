AUTOBAHN_DEBUG = false;
const autobahn = require('autobahn');
const moment = require('moment');
const HD44780 = require('./classes/HD44780');
const API = require('./classes/API');

const { fork } = require('child_process');

let App = class App {
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
            if (msg.temperature !== undefined && msg.temperature.constructor === Array) {
                let sum = msg.temperature.reduce((a, b) => a + b, 0);
                if (this.temp !== sum) {
                    this.temp = sum;
                    this.LCD[1].print('Temp: ' + this.temp + String.fromCharCode(223) + 'C', 4);
                }
            }
            if (msg.sendtemperature !== undefined && msg.sendtemperature.constructor === Array) {
                let sum = msg.sendtemperature.reduce((a, b) => a + b, 0);
                API.request('https://hoogstraaten.eu/api/temperature', 'post', {"temperature": sum}).catch(error => {
                    return console.error(error);
                });
            }
        });
    }
};

let app = new App();

require('dotenv').config();

function onchallenge (session, method, extra) {
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(process.env.CLIENT_KEY, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
}

//Define crossbar stuff
let connection = new autobahn.Connection({
    url: 'wss://cb.hoogstraaten.eu/ws',
    realm: 'eu.hoogstraaten.fishtank',
    authid: process.env.CLIENT_USER,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = (session) => {
    app.cbSession = session;
    app.LCD[0].print('Sys. Status: Online', 2);
    
    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        let data = args[0];
        if (app.scheduleId === data.schedule_id) {
            app.lightsProcess.send({cmd: 'loadSchedule', args: data.schedule_id});
        }
    };
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    session.subscribe('wamp.subscription.on_subscribe', function (args, details) {
        session.publish('eu.hoogstraaten.fishtank.channelvalues.' + session.id, [app.channelValues], {}, {eligible: [args[0]]}); //Only publish to the client that just subscribed
        session.publish('eu.hoogstraaten.fishtank.time.' + session.id, [moment()], {}, {eligible: [args[0]]});
    });

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        try {
            app.lightsProcess.send({cmd: 'loadSchedule', args: args[0]});
        } catch (error) {
            console.log(error);
        }
    };
    session.register('eu.hoogstraaten.fishtank.setschedule.' + session.id, setSchedule);
    
    //Register procedure for getting the loaded schedule's id
    session.register('eu.hoogstraaten.fishtank.getactivescheduleid.' + session.id, function () {
        return app.scheduleId;
    });

    //Register procedure for setting channel override
    function setChannelOverride(args) {
        app.lightsProcess.send({cmd: 'setChannelOverride', args: args});
    }
    session.register('eu.hoogstraaten.fishtank.setchanneloverride.' + session.id, setChannelOverride);

    //Register procedure for cycleing through loaded schedule
    function setLedValue(args) {
        app.lightsProcess.send({cmd: 'setLedValue', args: args});
    };
    session.register('eu.hoogstraaten.fishtank.setledvalue.' + session.id, setLedValue);

    console.log('Client connected to cb.hoogstraaten.eu!');
};

connection.onclose = function (reason, details) {
    app.LCD[0].print('Sys. Status: Offline', 2);
    app.cbSession = null;
    console.log("Connection lost:", reason, details);
};

//Connect to Crossbar
connection.open();
