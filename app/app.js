/*global Meteor, Template, Mongo, check, Match, Accounts, R, Random, EJSON*/

(function () {
    'use strict';

    /** Imports */



    /** Constants */

    const isValid = (x, pattern) => !check(x, pattern) && x;
    const map = R.map;
    const mapObjIndexed = R.mapObjIndexed;
    const filter = R.filter;
    const find = R.find;
    const groupBy = R.groupBy;
    const prop = R.prop;



    const versionPattern = Match.Where(x => isValid(x, String));



    const buildVersion = () => String(Math.floor(Math.random() * 100));



    const objectPattern =
              (function (versionPattern) {
                  return { '_id': Mongo.ObjectID, 'name': String, 'version': versionPattern };
              }(versionPattern));



    const trackedObjectPattern =
              (function (versionPattern) {
                  return {
                      '_id': Mongo.ObjectID
                      , 'collection': String
                      , 'id': Mongo.ObjectID
                      , 'version': versionPattern
                      , 'updated': Boolean
                  };
              }(versionPattern));



    const trackersPattern =
              (function (trackedObjectPattern) {
                  const maxLength = 5;
                  return Match.Where(x => isValid(x, [trackedObjectPattern]).length <= maxLength);
              }(trackedObjectPattern));



    const objects = new Mongo.Collection('objects');



    const collections =
              {
                  objects
              };



    Meteor.methods(
        {
            'addTracker': function (tracker) {
                const userId = this.userId;
                check(tracker, trackedObjectPattern);
                Meteor.users.update({ '_id': userId }, { '$push': { 'profile.trackers': tracker } });
                return 'Tracker added!';
            }

            , 'updateObjectVersion': function (_id, version) {
                check(_id, Mongo.ObjectID);
                check(version, versionPattern);
                objects.update({ _id }, { '$set': { version } });
            }

            , 'readTracker': function (trackerId, version) {
                const userId = this.userId;
                check(trackerId, Mongo.ObjectID);
                check(version, versionPattern);

                Meteor.users.update(
                    { '_id': userId, 'profile.trackers._id': trackerId }
                    , { '$set': { 'profile.trackers.$.version': version } }
                );
            }
        });



    if (Meteor.isClient) {

        const T = Template;
        const body = T.body;

        body.onCreated(function () {
            const self = this;
            self.autorun(() => {
                const maybeUser = Meteor.user();
                if (maybeUser) {
                    Meteor.subscribe('objects');
                    Meteor.subscribe('notifications', maybeUser.profile.trackers);
                }
            });

        });



        body.helpers(
            {
                'objects': () => map((o) => ({ 'collection': 'objects', 'object': o }), objects.find({}))

                , 'nbrObjects': () => objects.find({}).count()

                , 'nbrTrackedObjects': () => Meteor.user().profile.trackers.length

                , 'notifications': () => map(t => ({ 'object': objects.findOne({ '_id': t.id })
                                                     , 'tracker': t })
                                             , filter(t => t.updated, Meteor.user().profile.trackers))

                , 'notNotifications': () => map(t => ({ 'object': objects.findOne({ '_id': t.id })
                                                        , 'tracker': t })
                                                , filter(t => !t.updated, Meteor.user().profile.trackers))
            });



        const mayFollowObject = T.mayFollowObject;

        mayFollowObject.events(
            {
                'click .track': (evt, tpt) => {
                    const d = tpt.data;
                    const object = d.object;

                    Meteor.call(
                        'addTracker'
                        , isValid({
                            '_id': new Mongo.ObjectID()
                            , 'collection': d.collection
                            , 'id': object._id
                            , 'version': object.version
                            , 'updated': false
                        }, trackedObjectPattern));

                    return false;
                }
                , 'click .update': (evt, tpt) => {
                    Meteor.call('updateObjectVersion', tpt.data.object._id, buildVersion());
                    return false;
                }
            });



        const notification = T.notification;

        notification.events(
            {
                'click .read': (evt, tpt) => {
                    const d = tpt.data;
                    Meteor.call('readTracker', d.tracker._id, d.object.version);
                    return false;
                }
            });
    }



    if (Meteor.isServer) {

        if (objects.find({}).count() === 0) {
            objects.insert(isValid({ '_id': new Mongo.ObjectID(), 'name': Random.id().substr(0, 4), 'version': buildVersion() }, objectPattern));
            objects.insert(isValid({ '_id': new Mongo.ObjectID(), 'name': Random.id().substr(0, 4), 'version': buildVersion() }, objectPattern));
        }



        Accounts.onCreateUser((options, user) => { user.profile = { 'trackers': isValid([], trackersPattern) }; return user; });



        Meteor.publish('objects', () => objects.find({}));



        const isTrackerUpdated = (userId, tracker, version) => Meteor.users.update({ '_id': userId, 'profile.trackers._id': tracker._id }, { '$set': { 'profile.trackers.$.updated': tracker.version !== version } });



        Meteor.publish('notifications', function (trackers) {
            const self = this;
            const userId = self.userId;
            check(trackers, trackersPattern);

            mapObjIndexed(
                (trackers, collection) => {
                    collections[collection]
                        .find({ '_id': { '$in': map(t => t.id, trackers) } })
                        .observeChanges(
                            {
                                'added': (id, fields) => {
                                    const maybeTracker = find(t => EJSON.equals(t.id, id), trackers);
                                    maybeTracker && isTrackerUpdated(userId, maybeTracker, fields.version);
                                }
                                , 'changed': (id, fields) => {
                                    const maybeTracker = find(t => EJSON.equals(t.id, id), trackers);
                                    maybeTracker && isTrackerUpdated(userId, maybeTracker, fields.version);
                                }
                            }
                        );
                }
                , groupBy(prop('collection'), trackers)
            );
        });
    }



    /** Variables */



    /** API */
}());
