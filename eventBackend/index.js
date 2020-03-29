var express = require('express');
var mongoose = require('mongoose');
var Event = require('./models/event');
var Booking = require('./models/booking');
var mongoose = require('mongoose');
var utility = require('./utility/objectIdChecker');

//Import a body parser module to be able to access the request body as json
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');

const cors = require('cors');

const apiPath = '/api/';
const version = 'v1';

var mongoURI = 'mongodb://localhost:27017/eventbackend';
var port = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true }, function (err) {
    if (err) {
        console.error(`Failed to connect to MongoDB with URI: ${mongoURI}`);
        console.error(err.stack);
        process.exit(1);
    }
    console.log(`Connected to MongoDB with URI: ${mongoURI}`);
});

// Create Express app
var app = express();

// Parse requests of content-type 'application/json'
app.use(bodyParser.json());

//Tell express to use cors -- enables CORS for this backend
app.use(cors());

// Enable Auth for all of the following endpoints:
app.use(basicAuth(((req, res, next) => {

        const auth = {
        users: sha256( {'admin':'secret'} ) }
      
        // parse login and password from headers
        const b64auth = (req.headers.authorization || '').split(' ')[1] || ''
        const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':')
      
        // Verify login and password are set and correct
        if (login && password && login === auth.login && password === auth.password) {
          // Access granted...
          return next()
        }
      
        // Access denied...
        res.set('WWW-Authenticate', 'Basic realm="401"') // 
        res.status(401).send('Authentication required.') // 
      
})));

//Event endpoints

// Get all events
app.get(apiPath + version + '/events', (req, res) => {
    Event.find({ }, '-__v -description -location', function (err, events) {
        if (err) { return next(err); }
        res.status(200).json(events);
    });
});
// Get single event by id
app.get(apiPath + version + '/events/:eventId', (req, res) => {
    if (!utility.isValidObjectID(req.params.eventId)) {
        return res.status(404).json({ "error": "Event not found!" });
    }
    Event.findById(req.params.eventId, '-__v', function (err, event) {
        if (err) { return next(err); }
        if (event == null) {
            return res.status(404).json({ "error": "Event not found" });
        }

        var eventObj = event._doc;
        eventObj.bookings = [];

// Find booking for event
        Booking.find({ eventId: req.params.eventId }, '_id', (err, bookings) => {
            if (err) { return res.status(500).json({ "message": "Internal server error on getting bookings to an event." }); }

            for (let i = 0; i < bookings.length; i++) {
                eventObj.bookings.push(bookings[i]._id);
            }

            res.status(200).json(eventObj);
        });
    });
});

// Make a new event
app.post(apiPath + version + '/events', (req, res) => {
    var event = new Event(req.body);
    event.save(function (err) {
        if (err && err.name === 'ValidationError' && err instanceof mongoose.Error.ValidationError) {
            return res.status(400).json({ "error": "Incorrect format of request body" });
        } else {
            res.status(201).json(event.getPublic());
        }
    });
});

// Delete an event with id
app.delete(apiPath + version + '/events/:eventId', (req, res) => {
    if (!utility.isValidObjectID(req.params.eventId)) {
        return res.status(404).json({ "error": "Event not found!" });
    }

    Booking.find({ eventId: req.params.eventId }, (err, bookings) => {
        if (err) { return res.status(500).json({ "message": "Internal server error." }); }

        if (bookings.length > 0) {
            return res.status(400).json({ "message": "Cannot delete events with existing bookings." });
        } else {
            Event.findOneAndDelete({ _id: req.params.eventId }, function (err, event) {
                if (err || event == null) { return res.status(404).json({ "error": "Event not found!" }); }

                let eventObj = event.getPublic();
                eventObj.bookings = [];

                return res.status(200).json(eventObj);
            });
        }
    });
});

//Bookings endpoints
// Get all bookings
app.get(apiPath + version + '/events/:eventId/bookings', (req, res) => {
    if (!utility.isValidObjectID(req.params.eventId)) {
        return res.status(404).json({"message": "Event not found!"});
    }

    Booking.find({eventId: req.params.eventId}, '-__v -eventId', function(err, bookings) {
        if (err) { return res.status(500).json({ "message": "Internal server error on getting all bookings." }); }
        res.status(200).json(bookings);
    });
});

// Get booking by ID
app.get(apiPath + version + '/events/:eventId/bookings/:bookingId', (req, res) => {
    if (!utility.isValidObjectID(req.params.eventId)) {
        return res.status(404).json({"message": "Event not found!"});
    }

    if (!utility.isValidObjectID(req.params.bookingId)) {
        return res.status(404).json({"message": "Booking not found!"});
    }

    Booking.findOne({eventId: req.params.eventId, _id: req.params.bookingId}, '-__v -eventId', function(err, booking) {
        if (err) { return res.status(500).json({ "message": "Internal server error on getting a booking." }); }

        if (booking === null) {
            return res.status(404).json({"message":"Booking not found."});
        }
        res.status(200).json(booking);
    });
});

// Create a new booking
app.post(apiPath + version + '/events/:eventId/bookings', (req, res) => {
    if (!utility.isValidObjectID(req.params.eventId)) {
        return res.status(404).json({"message": "Event not found!"});
    }

    Event.findOne({_id: req.params.eventId}, '-__v', function (err, event) {
        if (err) { return next(err); }
        if (event == null) {
            return res.status(404).json({ "error": "Event not found" });
        }

        if (req.body.tel === undefined && req.body.email === undefined) {
            return res.status(400).json({ "error": "Email or tel is required for a booking." });
        }

        if (req.body.spots === undefined) {
            return res.status(400).json({ "error": "Spots is required for a booking." });
        }

        Booking.aggregate([ { $match: { "eventId": new mongoose.Types.ObjectId(req.params.eventId) } },
                            { $group : { _id : "$eventId", total : { $sum : "$spots" } } }])
                            .exec((err, sum) => {
                                if (err) { return next(err); }
                                
                                let remainingCap = event.capacity;

                                if (sum.length !== 0) {
                                    remainingCap -= sum[0].total;
                                }

                                if (req.body.spots > remainingCap) {
                                    return res.status(400).json({ "error": "Not enough spots available for this event." });
                                }

                                let myBookingObj = req.body;
                                myBookingObj.eventId = req.params.eventId;
                                let booking = new Booking(myBookingObj);
            
                                booking.save(function(err) {
                                    if (err) { 
                                        return res.status(500).json({ "message": "Internal server error while storing booking." }); 
                                    }
                                    res.status(201).json(booking.getPublic());
                                });
                            });
    });
});

//Delete a booking by bookingID
app.delete(apiPath + version + '/events/:eventId/bookings/:bookingId', (req, res) => {
    if (!utility.isValidObjectID(req.params.eventId)) {
        return res.status(404).json({"message": "Event not found!"});
    }

    if (!utility.isValidObjectID(req.params.bookingId)) {
        return res.status(404).json({"message": "Booking not found!"});
    }

    Booking.findOneAndDelete({eventId: req.params.eventId, _id: req.params.bookingId}, function(err, booking) {
        if (err) { return res.status(500).json({ "message": "Internal server error on getting a booking." }); }
        if (booking === null) {
            return res.status(404).json({"message":"Booking not found."});
        }

        res.status(200).json(booking.getPublic());
    });
});

//Default: Not supported
app.route('*', (req, res) => {
    res.status(405).send('Operation not supported.');
});


// Error handler
var env = app.get('env');
app.use(function (err, req, res, next) {
    console.error(err.stack);
    var err_res = {
        "message": err.message,
        "error": {}
    };
    if (env === 'development') {
        err_res["error"] = err;
    }
    res.status(err.status || 500);
    res.json(err_res);
});

app.listen(port, () => {
    console.log('Event app listening...');
});

module.exports = app;