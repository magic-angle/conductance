/* (c) 2013-2014 Oni Labs, http://onilabs.com
 *
 * This file is part of Conductance, http://conductance.io/
 *
 * It is subject to the license terms in the LICENSE file
 * found in the top-level directory of this distribution.
 * No part of Conductance, including this file, may be
 * copied, modified, propagated, or distributed except
 * according to the terms contained in the LICENSE file.
 */

/**
  @summary Key-Value Storage
  @hostenv nodejs
*/

module.setCanonicalId('mho:flux/kv');

@ = require(['sjs:std', {id:'sjs:type', include:['Interface']}, {id:'./kv/encoding', name:'encoding'}]);

/**
   @class KVStore
   @summary Key-value store abstraction 
   @desc
     Objects of class KVStore implement the [::ITF_KVSTORE] interface. You
     can use them with the [./kv::] module API functions, in particular [::get], 
     [::set], [::range], [::observe], 
     [::observeRange], [::children], [::observeChildren] and [::withTransaction].
     
     For a concrete implementation of KVStore, see [::LevelDB].
*/

/**
   @variable ITF_KVSTORE
   @summary Internal interface for [::KVStore] objects
   @desc
    The interface is not intended to be used by client code directly, but through
    one of the [./kv::] API functions, in particular [::get], [::set], [::range], [::observe], 
    [::observeRange], [::children], [::observeChildren] and [::withTransaction].

     Objects implementing this interface must implement the following functions:
     
         obj[ITF_KVSTORE].get(key) // return value associated with key ('undefined' if not existant)
     
         obj[ITF_KVSTORE].put(key, encoded_value) // set or delete (if value===undefined) entries in the store

         obj[ITF_KVSTORE].range(begin, [end], [options]) // return range of [key,value] pairs in interval [begin, end[

         obj[ITF_KVSTORE].observe(key) // return observable tracking key

         obj[ITF_KVSTORE].observeRange(begin, [end], [options]) // return observable tracking range
         
         obj[ITF_KVSTORE].withTransaction([options], block) // call block with a transaction [::KVStore] object.

    ITF_KVSTORE functions operate on 'encoded' key and value buffers. The [./kv::] API function
    ([::get], etc) mediate between the user-facing key and value representations ([::Key]s and 
    serializable JS objects, respectively) and the encoded binary representations.


*/
__js var ITF_KVSTORE = exports.ITF_KVSTORE = module .. @Interface('kvstore');


/**
   @class Key
   @summary Structure serving as a key into a [::KVStore].
   @desc
      A `Key` is either a String or Integer, or a tuple of Strings and Integers 
      represented by an (abitrarily nested) Array.

      Nested Array keys such as `['employee', ['name', 'alex']]` are equivalent
      to their flattened representations: `['employee', 'name', 'alex']`. Similarly the 
      key `1` is equivalent to `[1]` and `'alex'` is equivalent to `['alex']`.
      API functions that return keys will always return the canonical flattened 
      array representation.

      Keys are sorted in a way that preserves the ordering of the
      individual elements of a tuple key from left to right. This makes it possible to 
      efficiently query [::KVStore]s for all children with a common prefix ([::children]).
      
*/

/**
   @class Value
   @summary Object that can be stored as a value in a [::KVStore]
   @desc
     A `Value` can be any JSON-serializable JavaScript object.
*/

//----------------------------------------------------------------------
// KV API

/**
   @function get
   @param {::KVStore} [kvstore]
   @param {::Key} [key]
   @return {::Value|undefined} Value stored under key or `undefined` if there is no value stored for the given key.
   @summary Retrieve value stored under key.
*/
function get(store, key) {
  return store[ITF_KVSTORE].get(@encoding.encodeKey(key)) .. @encoding.decodeValue;
}
exports.get = get;

/**
   @function set
   @param {::KVStore} [kvstore]
   @param {::Key} [key]
   @param {::Value} [value]
   @summary Sets key to the given value.
*/
function set(store, key, value) {
  // assert value !== undefined; that would be a 'clear' operation
  return store[ITF_KVSTORE].put(@encoding.encodeKey(key), 
                                @encoding.encodeValue(value));
}
exports.set = set;

/**
   @function clear
   @param {::KVStore} [kvstore]
   @param {::Key} [key]
   @summary Clears any value currently associated with key.
*/
function clear(store, key) {
  return store[ITF_KVSTORE].put(@encoding.encodeKey(key), undefined);
}
exports.clear = clear;

/**
   @function range
   @param {::KVStore} [kvstore]
   @param {::Key} [start] 
   @param {optional ::Key} [end]
   @param {optional Object} [settings]
   @return {sjs:sequence::Stream}
   @setting {Boolean} [reverse=false] Reverse direction of range
   @setting {Integer} [limit=-1] Limit number of elements returned in range. (-1 == no limit)
   @summary Return a [sjs:sequence::Stream] of `[key, value]` pairs in the range [start, end[.
*/

// helper to decode a key,val tuple:
__js function decodeKV([k,v]) {
  return [ k .. @encoding.decodeKey,
           v .. @encoding.decodeValue];
}

function range(store, start, end, options) {
  if (arguments.length === 3 && !Array.isArray(end) && typeof end == 'object') {
    options = end;
    end = undefined;
  }
  start = @encoding.encodeKey(start);
  if (end !== undefined)
    end = @encoding.encodeKey(end);
  return store[ITF_KVSTORE].range(start, end, options) .. @transform(decodeKV);
}
exports.range = range;

/**
   @function children
   @param {::KVStore} [kvstore]
   @param {::Key} [parent]
   @param {optional Object} [settings]
   @return {sjs:sequence::Stream}
   @setting {Boolean} [reverse=false] Reverse direction of range
   @setting {Integer} [limit=-1] Limit number of elements returned in range. (-1 == no limit)
   @summary Return a [sjs:sequence::Stream] of `[key, value]` pairs that have `parent` as a prefix.
*/
function children(store, parent, options) {
  var { start, end } = @encoding.encodeKeyRange(parent);
  return store[ITF_KVSTORE].range(start, end, options) .. @transform(decodeKV);
}
exports.children = children;

/**
   @function observe
   @param {::KVStore} [kvstore]
   @param {::Key} [key]
   @return {sjs:observable::Observable}
   @summary Return an [sjs:observable::Observable] of the value associated with key.
     
*/
function observe(store, key) {
  return store[ITF_KVSTORE].observe(@encoding.encodeKey(key)) .. @transform(val -> val .. @encoding.decodeValue);
}
exports.observe = observe;


/**
   @function observeRange
   @param {::KVStore} [kvstore]
   @param {::Key} [start]
   @param {optional ::Key} [end]
   @param {optional Object} [settings]
   @return {sjs:observable::Observable}
   @setting {Boolean} [reverse=false] Reverse direction of range
   @setting {Integer} [limit=-1] Limit number of elements returned in range. (-1 == no limit)
   @summary Return an [sjs:observable::Observable] of the [sjs:sequence::Stream] of `[key, value]` pairs in the range [start, end[.

*/
function observeRange(store, start, end, options) {
  if (arguments.length === 3 && !Array.isArray(end) && typeof end == 'object') {
    options = end;
    end = undefined;
  }
  start = @encoding.encodeKey(start);
  if (end !== undefined)
    end = @encoding.encodeKey(end);
  return store[ITF_KVSTORE].observeRange(start, end, options) .. @transform(range -> range .. @transform(decodeKV));
}
exports.observeRange = observeRange;

/**
   @function observeChildren
   @param {::KVStore} [kvstore]
   @param {::Key} [parent]
   @param {optional Object} [settings]
   @return {sjs:observable::Observable}
   @setting {Boolean} [reverse=false] Reverse direction of range
   @setting {Integer} [limit=-1] Limit number of elements returned in range. (-1 == no limit)
   @summary Return an [sjs:observable::Observable] of the [sjs:sequence::Stream] of `[key, value]` pairs that have `parent` as a prefix.
*/
function observeChildren(store, parent, options) {
  var { start, end } = @encoding.encodeKeyRange(parent);
  return store[ITF_KVSTORE].observeRange(start, end, options) .. @transform(range -> range .. @transform(decodeKV));
}
exports.observeChildren = observeChildren;

/**
   @function withTransaction
   @altsyntax kvstore .. withTransaction { |transaction| ... }
   @param {::KVStore} [kvstore]
   @param {Function} [block] Function that will be passed a transaction object (a [::KVStore]).
   @summary Run code in `block` in a transaction.
   @desc
     The transaction object passed to `block` is a [::KVStore] itself
     and can be used with all the [./kv::] API functions ([::get],
     [::set], etc).

     The transaction will be committed when `block` exits normally
     (and aborted when e.g. code within `block` throws an Error).

     On committing, the transaction ascertains if there are any
     conflicts: If any of the keys read or written to within the
     transaction have been concurrently modified from outside of the
     transaction, `block` will be called again; indefinitely until no
     conflicts are detected. Then all mutations performed in `block`
     will be applied to the underlying database and `withTransaction`
     returns. This guarantees that after a `withTransaction` call
     returns, all reads and writes have been performed atomically,
     consistently, in isolation and durably.

     Transactions can be nested. The transaction will be committed
     when the outermost transaction block exits.

     [::get], [::range] and [::children] calls performed in the
     transactional context will reflect any prior mutations applied in
     the same transaction (before they are committed to the database).

     [::observe], [::observeRange] and [::observeChildren] calls
     performed in the transactional context will reflect any prior and
     future mutations applied in the same transaction (before they are
     committed to the database).
*/
function withTransaction(store, options, block) {
  if (arguments.length === 2) {
    block = options;
    options = undefined;
  }
  return store[ITF_KVSTORE].withTransaction(options, block);
}
exports.withTransaction = withTransaction;

//----------------------------------------------------------------------
// KVStore implementations:

/**
  @class LevelDB
  @inherit ::KVStore
  @hostenv nodejs
  @summary Simple fast and efficient persistent local key-value storage backed by [LevelDB](http://en.wikipedia.org/wiki/LevelDB)
  @function LevelDB
  @altsyntax LevelDB(location, [options]) { |kvstore| ... }
  @param {String} [location] Location of DB on disk
  @param {optional Object} [options] See https://github.com/rvagg/node-leveldown#leveldownopenoptions-callback
  @param {optional Function} [block] Lexical block to scope the LevelDB object to
*/
exports.LevelDB = -> require('./kv/leveldb').LevelDB.apply(null, arguments);