AUTOBAHN_DEBUG = false;
const autobahn = require('autobahn');
const moment = require('moment');
const HD44780 = require('./classes/HD44780');
const { fork } = require('child_process');

let App = class App {
    constructor() {
        this.version = 'v0.1.2';

        this.scheduleId = null;
        this.scheduleName = null;
        this.channelValues = null;

        this.cbSession = null;

        this.LCD = [new HD44780(1, 0x3f, 20, 4), new HD44780(1, 0x3e, 20, 4)];
        this.LCD[0].clear();
        this.LCD[1].clear();
        this.LCD[0].print('AquaMatic v0.1.1', 1);

        this.lightsProcess = null;
        this.timeProcess = null;

        this._startProcesses();
    };
    _startProcesses() {
        this.lightsProcess = fork('./classes/lights.js');
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
        this.timeProcess = fork('./time.js');
        this.timeProcess.on('message', (msg) => {
            //console.log(msg);
            if (msg.time !== undefined) {
                this.LCD[0].print('Date: ' + moment(msg.time).format('DD/MM/YYYY'), 3);
                this.LCD[0].print('Time: ' + moment(msg.time).format('HH:mm:ss'), 4);
                if (this.cbSession !== null) {
                    this.cbSession.publish('eu.hoogstraaten.fishtank.time.' + this.cbSession.id, [msg.time]);
                }
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
    //Lights.LCD[1].print('Status: Online', 3);
    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        let data = args[0];
        //If updated schedule has the same id as our loaded schedule then retreive it's updated content from the API
        app.lightsProcess.send({cmd: 'loadSchedule', args: args[0]});

    };
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    session.subscribe('wamp.subscription.on_subscribe', function (args, details) {
        session.publish('eu.hoogstraaten.fishtank.channelvalues.' + session.id, [app.channelValues], {}, {eligible: [args[0]]}); //Only publish to the client that just subscribed
    });

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        try {
            console.log(args[0]);
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
    app.LCD[0].print('Sys. Status: Offline', 3);
    //Lights.LCD[1].print('Status: Offline', 3);
    //Lights.crossbarsession = null;
    console.log("Connection lost:", reason, details);
};

//Start crossbar
connection.open();