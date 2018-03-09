const pigpio = require('pigpio');
const Gpio = pigpio.Gpio;

let heater = new Gpio(25, {mode: Gpio.OUTPUT});
let co2 = new Gpio(16, {mode: Gpio.INPUT});
//let led = new Gpio(19, {mode: Gpio.OUTPUT});

//led.pwmWrite(250);
//heater.digitalWrite(0);
heater.digitalWrite(1);
while(1) {
    heater.digitalWrite(1);
}
