AUTOBAHN_DEBUG = false;
const autobahn = require('autobahn');
const Lights = require('./classes/lights');
const DS18B20 = require('./classes/DS18B20');

require('dotenv').config();

function onchallenge (session, method, extra) {
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(process.env.CLIENT_KEY, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
}

Lights.init();

DS18B20.init();

//Define crossbar stuff
let connection = new autobahn.Connection({
    url: 'wss://cb.hoogstraaten.eu/ws',
    realm: 'eu.hoogstraaten.fishtank',
    authid: process.env.CLIENT_USER,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = function (session) {
    Lights.crossbarsession = session;
    Lights.LCD.print('Status: Online', 3);
    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        let data = args[0];
        //If updated schedule has the same id as our loaded schedule then retreive it's updated content from the API
        if(Lights.schedule.data.id === data.schedule_id) {
            Lights.loadSchedule(data.schedule_id);
        }

    };
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    session.subscribe('wamp.subscription.on_subscribe', function (args, details) {
        session.publish('eu.hoogstraaten.fishtank.channelvalues.' + session.id, [Lights.channelValues], {}, {eligible: [args[0]]}); //Only publish to the client that just subscribed
    });

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        try {
            console.log(args[0]);
            Lights.loadSchedule(args[0]);
        } catch (error) {
            console.log(error);
        }
    };
    session.register('eu.hoogstraaten.fishtank.setschedule.' + session.id, setSchedule);
    //Register procedure for getting the loaded schedule's id
    session.register('eu.hoogstraaten.fishtank.getactivescheduleid.' + session.id, function () {
        return Lights.schedule.data.id;
    });

    function setChannelOverride(args) {
        Lights.channelOverride[args[0]] = args[1];
    }
    session.register('eu.hoogstraaten.fishtank.setchanneloverride.' + session.id, setChannelOverride);

    //Register procedure for cycleing through loaded schedule
    function setLedValue(args) {
        Lights.setLedValue(args[0], args[1]);
    };
    session.register('eu.hoogstraaten.fishtank.setledvalue.' + session.id, setLedValue);

    console.log('Client connected to cb.hoogstraaten.eu!');
};

connection.onclose = function (reason, details) {
    Lights.LCD.print('Status: Offline', 3);
    Lights.crossbarsession = null;
    console.log("Connection lost:", reason, details);
};

//Start crossbar
connection.open();
