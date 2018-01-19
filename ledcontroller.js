AUTOBAHN_DEBUG = false;
const autobahn = require('autobahn');
const LcdController = require('./classes/lcdcontroller');
const LedController = require('./classes/ledcontroller');
require('dotenv').config();

function onchallenge (session, method, extra) {
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(process.env.CLIENT_KEY, extra.challenge);
    } else {
        throw "don't know how to authenticate using '" + method + "'";
    }
};

let LcdInstance = new LcdController(1, 0x3f, 20, 4);
let LedInstance = new LedController(LcdInstance);
LedInstance.init();

//Define crossbar stuff
let connection = new autobahn.Connection({
    url: 'wss://cb.hoogstraaten.eu/ws',
    realm: 'eu.hoogstraaten.fishtank',
    authid: process.env.CLIENT_USER,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = function (session) {
    LedInstance.crossbarsession = session;
    LcdInstance.print('Status: Online', 3);
    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        var data = args[0];
        //If updated schedule has the same id as our loaded schedule then retreive it's updated content from the API
        if(LedInstance.schedule.data.id === data.schedule_id) {
            LedInstance.loadSchedule(data.schedule_id);
        }

    }
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        try {
            console.log(args[0]);
            LedInstance.loadSchedule(args[0]);
        } catch (error) {
            console.log(error);
        }
    }
    session.register('eu.hoogstraaten.fishtank.setschedule.' + session.id, setSchedule);

    //Register procedure for getting the loaded schedule's id
    session.register('eu.hoogstraaten.fishtank.getactivescheduleid.' + session.id, function () {
        return LedInstance.schedule.data.id;
    });

    //Register procedure for cycleing through loaded schedule
    function cycle(args) {
        LedInstance.cycleSchedule(args[0]);
    }
    session.register('eu.hoogstraaten.fishtank.cycleschedule.' + session.id, cycle)

    console.log('Client connected to cb.hoogstraaten.eu!');
};

connection.onclose = function (reason, details) {
    LcdInstance.print('Status: Online', 3);
    LedInstance.crossbarsession = null;
    console.log("Connection lost:", reason, details);
};

//Start crossbar
connection.open();
