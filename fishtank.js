//Set debug mode
AUTOBAHN_DEBUG = process.env.AUTOBAHN_DEBUG;

const autobahn = require('autobahn');
const moment = require('moment');
const Fishtank = require('./classes/fishtank');

let fishtank = new Fishtank();

require('dotenv').config();

function onchallenge (session, method, extra) {
    if (method === "wampcra") {
        return autobahn.auth_cra.sign(process.env.CROSSBAR_CLIENT_KEY, extra.challenge);
    } else {
        throw "Don't know how to authenticate using '" + method + "'";
    }
}

//Define crossbar stuff
let connection = new autobahn.Connection({
    url: process.env.CROSSBAR_HOST,
    realm: process.env.CROSSBAR_REALM,
    authid: process.env.CROSSBAR_CLIENT_USER,
    authmethods: ["wampcra"],
    onchallenge: onchallenge
});

connection.onopen = (session) => {
    fishtank.cbSession = session;
    fishtank.LCD[0].print('Sys. Status: Online', 2);
    
    //Subscribe to topic for notification about updated schedules
    function onevent(args) {
        let data = args[0];
        if (fishtank.scheduleId === data.schedule_id) {
            fishtank.lightsProcess.send({cmd: 'loadSchedule', args: data.schedule_id});
        }
    };
    session.subscribe('eu.hoogstraaten.fishtank.publish', onevent);

    session.subscribe('wamp.subscription.on_subscribe', function (args, details) {
        session.publish('eu.hoogstraaten.fishtank.channelvalues.' + session.id, [fishtank.channelValues], {}, {eligible: [args[0]]}); //Only publish to the client that just subscribed
        session.publish('eu.hoogstraaten.fishtank.time.' + session.id, [moment()], {}, {eligible: [args[0]]});
    });

    //Register procedure for setting a new schedule
    function setSchedule(args) {
        try {
            fishtank.lightsProcess.send({cmd: 'loadSchedule', args: args[0]});
        } catch (error) {
            console.log(error);
        }
    };
    session.register('eu.hoogstraaten.fishtank.setschedule.' + session.id, setSchedule);
    
    //Register procedure for getting the loaded schedule's id
    session.register('eu.hoogstraaten.fishtank.getactivescheduleid.' + session.id, function () {
        return fishtank.scheduleId;
    });

    //Register procedure for setting channel override
    function setChannelOverride(args) {
        fishtank.lightsProcess.send({cmd: 'setChannelOverride', args: args});
    }
    session.register('eu.hoogstraaten.fishtank.setchanneloverride.' + session.id, setChannelOverride);

    //Register procedure for cycleing through loaded schedule
    function setLedValue(args) {
        fishtank.lightsProcess.send({cmd: 'setLedValue', args: args});
    };
    session.register('eu.hoogstraaten.fishtank.setledvalue.' + session.id, setLedValue);

    console.log('Client connected to cb.hoogstraaten.eu!');
};

connection.onclose = (reason, details) => {
    fishtank.LCD[0].print('Sys. Status: Offline', 2);
    fishtank.cbSession = null;
    console.log("Connection lost:", reason, details);
};

//Connect to Crossbar
connection.open();
