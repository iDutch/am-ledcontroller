const lights = require('./../classes/lights');
lights.init();

process.on('message', (msg) => {
    switch (msg.cmd) {
        case "loadSchedule":
            lights.loadSchedule(msg.args);
            break;
        case "setChannelOverride":
            lights.channelOverride[msg.args[0]] = msg.args[1];
            break;
        case "setLedValue":
            lights.setLedValue(msg.args[0], msg.args[1]);
            break;
    }
});
