var { propertyPairs, keys } = require('sjs:object');
var { each, map, Stream, transform, join, buffer, unpack, slice, reduce, filter, indexed, toArray, at, zip, consume } = require('sjs:sequence');
var { isArrayLike } = require('sjs:array');
var { unbatched } = require('sjs:function');
var { instantiate, isSimpleType, IdToKey, cotraverse } = require('./schema');
var { Context } = require('./gcd/backend');
var { ChangeBuffer } = require('./helpers');

//----------------------------------------------------------------------
// Google Cloud Datastore 

// Serialized key: kind.name/kind.name/...
// kind and name must not contain slashes or dots.
// kinds and names matching the regexp __.*__ are reserved by GCD
// name must not start with '#' (unless generated by the db - see GCD docs).

// Example:

// key:      'Company.Oni Labs/Person.Alexander Fritze'
// parent:   'Company.Oni Labs'
// id:       'Alexander Fritze'
// kind:     'Person'

function keyToGCDKey(path) {
  return path.split('/') ..
    map(function(pelem) {
      var [kind, id_or_name] = pelem.split(':');
      if (!id_or_name)
        return { kind: kind };
      else if (id_or_name.charAt(0) == '#')
        return { kind: kind, id: id_or_name.substr(1) }
      else
        return { kind: kind, name: id_or_name }
    });
}

function GCDKeyToKey(path) {
  return path .. 
    transform({kind, name, id} -> name ? "#{kind}:#{name}" : "#{kind}:##{id}") ..
    join('/');
}

function GCDKeyToId(path) {
  var last = path[path.length-1];
  return last.id ? "##{last.id}" : last.name;
}

function GCDKeyToKind(path) {
  var last = path[path.length-1];
  return last.kind;
}

function GCDKeyToParent(path) {
  return GCDKeyToKey(path .. slice(0,-1));
}


function GCDValueToJSValue(gcd_value, descriptor) {
  var base_val;
  switch (descriptor.__type) {
  case 'date':
    if (gcd_value.timestampMicrosecondsValue === undefined)
      base_val = null;
    else
      base_val = new Date(parseInt(gcd_value.timestampMicrosecondsValue.substr(0,gcd_value.timestampMicrosecondsValue.length-3)));
    break;
  case 'bool':
    if (gcd_value.integerValue === undefined)
      base_val = null;
    else
      base_val = Boolean(Number(gcd_value.integerValue));
    break;
  case 'integer':
    if (gcd_value.integerValue === undefined)
      base_val = null;
    else
      base_val = Number(gcd_value.integerValue);
    break;
  case 'float':
    if (gcd_value.doubleValue === undefined)
      base_val = null;
    else
      base_val = Number(gcd_value.doubleValue);
    break;
  case 'string':
  case 'text':
    if (gcd_value.stringValue === undefined)
      base_val = null;
    else
      base_val = gcd_value.stringValue;
    break;
  case 'ref':
    if (gcd_value.keyValue === undefined)
      base_val = null;
    else
      base_val = GCDKeyToKey(gcd_value.keyValue.pathElement);
    break;
  default:
    throw new Error("Schema error: Unknown type #{descriptor.__type}");
  }
  if (descriptor.fromRepository)
    base_val = descriptor.fromRepository(base_val);
  return base_val;
}

function JSValueToGCDValue(js_val, descriptor) {
  var value = {};

/*  if (descriptor.toRepository)
    js_val = descriptor.toRepository(js_val);
*/
  if (js_val === null) {
    if (descriptor.__allowNull)
      return value;
    else
      throw "Invalid 'null' value on a #{descriptor.__type} property without '__allowNull'";
  }
  
  switch (descriptor.__type) {
  case 'date':
    value.timestampMicrosecondsValue = js_val.getTime()+'000';
    break;
  case 'bool':
    value.integerValue = Boolean(js_val);
    break;
  case 'integer':
    value.integerValue = Number(js_val);
    break;
  case 'float':
    value.doubleValue = Number(js_val);
    break;
  case 'text':
    value.indexed = false;
    // fall through to string
  case 'string':
    value.stringValue = String(js_val);
    break;
  case 'ref':
    value.keyValue = {pathElement:keyToGCDKey(js_val)};
    break;
  default:
    throw "Unknown type #{descriptor.__type}";
  }
  return value;
}

function JSEntityToGCDEntity(js_entity, schemas) {
  var schema = schemas[js_entity.schema];
  if (!schema) throw new Error("Unknown schema #{js_entity.schema}");
  var key = js_entity.id;
  var gcd_entity = { property:[] };

  js_entity.data .. cotraverse(schema) {
    |node, descriptor|
    //console.log("iterating #{node.path} #{node.value}");
    if (descriptor.type === 'object') {
      // feed through parent context (or create new one at the root)
      node.state = node.parent_state || {};
      // if we're in an array, every field of structured data must
      // exist (see also comment below):
      if (node.state.arr_ctx && node.value === undefined)
        throw new Error("Google Cloud Datastore: Undefined values in arrays not supported (#{node.path})");
    }
    else if (descriptor.type === 'key') {
      if (key && node.value !== key) 
        throw new Error("Google Cloud Datastore: Inconsistent key values in data ('#{key}' != '#{node.value}')");
      key = node.value;
    }
    else if (descriptor.type === 'array') {
      if (node.parent_state.arr_ctx)
        throw new Error("Google Cloud Datastore: Nested arrays not supported (#{node.path})");
      node.state = Object.create(node.parent_state);
      node.state.arr_ctx = {};
    }
    else if (node.parent_state.arr_ctx) {
      // we're in an array

      // We store structed array data in separate, parallel
      // multi-valued properties.  For this scheme to work, every
      // field of a structured array value must have a value (possibly
      // 'Null'), otherwise the correspondance between array fields
      // will get out of sync. 
      if (node.value === undefined) 
        throw new Error("Google Cloud Datastore: Undefined values in arrays not supported (#{node.path})");

      if (!node.parent_state.arr_ctx[descriptor.path]) {
        gcd_entity.property.push({
          name: descriptor.path.replace(".[]", ""),
          multi: true,
          value: (node.parent_state.arr_ctx[descriptor.path] = [])
        });
      }
      node.parent_state.arr_ctx[descriptor.path].push(JSValueToGCDValue(node.value, descriptor.value));
    }
    else if (node.value !== undefined) {
      // a single-valued property:
      gcd_entity.property.push({
        name: node.path,
        value: [JSValueToGCDValue(node.value, descriptor.value)]
      });
    }
  }

  if (!key) {
    key = schema.__parent ? schema.__parent + '/' : '';
    key += js_entity.schema;
  }

  gcd_entity.key = { pathElement: keyToGCDKey(key) };

  return gcd_entity;
}


function GCDEntityToJSEntity(gcd_entity, js_entity, schemas) {
  if (!gcd_entity) {
    js_entity.data = null;
    return js_entity;
  }
  var kind = GCDKeyToKind(gcd_entity.key.pathElement);
  var schema = schemas[kind];
  if (!schema) throw new Error("Google Cloud Datastore: Unknown schema #{kind}");

  var js_data = instantiate(schema);

  // go through properties array of GCD entity:
  (gcd_entity.property || []) .. each {
    |{name, value}|
    // find schema descriptor:
    var descriptor=schema, path=[], array_path;
    name.split('.') .. each {
      |n|
      descriptor = descriptor[n];
      if (!descriptor) break; 
      if (isArrayLike(descriptor)) {
        if (array_path) throw new Error("Invalid schema: nested arrays");
        path = path.concat(n);
        array_path = [];
        descriptor = descriptor[0];
      }
      else {
        if (array_path) {
          array_path = array_path.concat(n);
        }
        else {
          path = path.concat(n);
        }
      }
    }

    if (!descriptor) continue;

    // make sure path exists in js_data:
    var target = path .. slice(0,-1) .. 
      reduce(js_data, (target, p) -> target[p] ? target[p] : (target[p] = {}));

    if (!array_path) {
      // a single value
      target[path .. at(-1)] = GCDValueToJSValue(value[0], descriptor);
    }
    else {
      if (!target[path .. at(-1)])
        target = target[path .. at(-1)] = [];
      else
        target = target[path .. at(-1)];
      value .. indexed .. each { 
        |[i,v]|
        if (!array_path.length)
          target[i] = GCDValueToJSValue(v, descriptor);
        else {
          var base = target[i];
          if (!base) base = target[i] = {};
          base = array_path .. slice(0, -1) .. 
            reduce(base, (base, p) -> base[p] ? base[p] : (base[p] = {}));

          base[array_path .. at(-1)] = GCDValueToJSValue(v, descriptor);
        }
      }
    }
  }

  // now go through schema and pick up special properties (such as
  // __key), check if required properties are there, and fill in default properties
  propertyPairs(schema) .. each {
    |[name, descriptor]|
    if (js_data[name]) continue; // already there
    var base_val;
    switch (descriptor.__type) {
    case 'id':
      base_val = GCDKeyToId(gcd_entity.key.pathElement);
      break;
    case 'key':
      base_val = GCDKeyToKey(gcd_entity.key.pathElement);
      break;
    case 'parent':
      base_val = GCDKeyToParent(gcd_entity.key.pathElement);
      break;
    default:
//XXX      if (descriptor.__required)
//        throw new Error("Schema validation error: Missing value for property #{name}");
    }
    if (base_val !== undefined) {
      js_data[name] = base_val;
    }
  }

  var id = GCDKeyToKey(gcd_entity.key.pathElement);
  if (js_entity.id) {
    if (js_entity.id !== id) 
      throw new Error("Id mismatch: #{id} != #{js_entity.id}");
  }
  else
    js_entity.id = id;

  if (js_entity.schema) {
    if (js_entity.schema !== kind)
      throw new Error("Schema mismatch: #{kind} != #{js_entity.schema}");
  }
  else 
    js_entity.schema = kind;

  js_entity.data = js_data;

  return js_entity;
}

/**
   @class GoogleCloudDatastore
   @function GoogleCloudDatastore
   @param {Object} [attribs]
   @attrib {Object} [schemas]
   @attrib {Object} [context] Object with settings as described at [./gcd/backend::Context] (Note: this should not be a `Context` object itself, but a hash of settings that will be passed to to [./gcd/backend::Context]!)
 */

function GoogleCloudDatastore(attribs) {
  var CHANGE_BUFFER_SIZE = 100; // XXX should this be configurable?
  var change_buffer = ChangeBuffer(CHANGE_BUFFER_SIZE);
  var context = Context(attribs.context);
  var schemas = attribs.schemas;

  function writeInner(entities, transaction) {
    // XXX we need to catch errors for individual entities here and
    // feed them through to the corresponding `write` call. ATM we
    // just fail the whole batch if one entity errors.

    var ids = [];
    var deletes = [], autoid_inserts = [], upserts = [];
    
    entities .. each {
      |entity|
      if (entity.data === null && entity.id) {
        // DELETE
        deletes.push({pathElement: keyToGCDKey(entity.id)});
        ids.push(entity.id);
      }
      else if (entity.data) {
        // UPSERT 
        entity = JSEntityToGCDEntity(entity, schemas);
        
        // check if the entity has a full key path, or if we need to create an autoid
        // XXX we don't check for `id` in the js entity, because an id might have 
        // been constructed according to the schema (from a primary field).
        var last = entity.key.pathElement[entity.key.pathElement.length-1];
        var has_path = (last.id || last.name);
        if (has_path) {
          upserts.push(entity);
          ids.push(entity.key.pathElement .. GCDKeyToKey);
        }
        else {
          // need to generate autoids
          autoid_inserts.push(entity);
          // id needs to be resolved later:
          ids.push(null);
        }
      }
      else if (entity.id)
        throw new Error("Cannot write entity #{entity.id}: Missing 'data' field");
      else
        throw new Error("Malformed entity");
    }
    
    // we've now got our entities sorted into `deletes`,
    // `autoid_inserts` and `upserts`.
    // further processing depends on whether we're in a transaction or
    // in a blind write
    
    if (transaction) {
      // we're in a transaction. don't actually perform the write. just
      // return data for later comittal.
      if (autoid_inserts.length) {
        var req = { key: autoid_inserts .. map({key} -> key) };
        var results = context.allocateIds(req);
        // splice results into ids
        results.key .. consume {
          |next_id|
          for (var i=0;i<ids.length; ++i) {
            if (ids[i] === null)
              ids[i] = next_id().pathElement .. GCDKeyToKey;
          }
        }
        
        // splice results into autoid_inserts
        zip(results.key, autoid_inserts) .. each { 
          |[key, entity]|
          entity.key = key;
        }
        
        upserts = upserts.concat(autoid_inserts);
      }
      return { ids: ids, deletes: deletes, upserts: upserts };
    }
    else {
      // blind write
      var mutation = {};
      if (deletes.length) mutation['delete'] = deletes;
      if (autoid_inserts.length) mutation.insertAutoId = autoid_inserts;
      if (upserts.length) mutation.upsert = upserts;
      
      var result = context.blindWrite({mutation: mutation});
      
      if (autoid_inserts.length) {
        // splice auto ids into return array
        var auto_id_index = 0;
        for (var i=0; i<ids.length; ++i) {
          if (ids[i] !== null) continue;
          ids[i] = result.mutationResult.insertAutoIdKey[auto_id_index++].pathElement .. GCDKeyToKey;
        }
      }
      change_buffer.addChanges(ids);
      return ids;
    }
  }

  function readInner(entities, transaction) {
    console.log("GCD: read #{entities.length}: #{entities.. map(e->e.id)}");
    var query = [];
    entities .. indexed .. each {
      |[i,entity]|
      try {
        query.push({pathElement: keyToGCDKey(entity.id)})
      }
      catch (e) {
        entities[i] = e;
      }
    }
    var results = (transaction || context).lookup({
      key: query
    });
    
    // XXX we need to handle this
    if (results.deferred) console.log("WARNING: DEFERRED BATCH RESULTS IN GCD.read!!!");
    // index found results by id
    var found = {};
    (results.found || []) .. each {
      |result|
      found[GCDKeyToKey(result.entity.key.pathElement)] = result.entity;
    }
    entities .. indexed .. each {
      |[i,entity]|
      if (entity.id) {
        try {
          found[entity.id] .. GCDEntityToJSEntity(entity, schemas);
        }
        catch (e) {
          entities[i] = e;
        }
      }
      // else entity is an Error which will be thrown by our unbatched function
    }
    return entities;
  }

  function queryInner(query_descriptor, transaction) {
    console.log("GCD:query(#{query_descriptor .. require('sjs:debug').inspect})");
    var idsOnly = true; // XXX should we have a mode for returning
                        // full results too? It would complicate
                        // implementation of filters, etc
    var schema = schemas[query_descriptor.schema];
    if (!schema) throw new Error("Unknown schema #{query_descriptor.schema}");
    
    // XXX all of our queries are currently kind-queries
    var kind = query_descriptor.schema;
    
    var filters = [];
    var orders = [];
    var key = query_descriptor.id;
    
    if (query_descriptor.data) {
      cotraverse(query_descriptor.data, schema) {
        |node, descriptor|
        if (node.value === undefined) continue;
        if (descriptor.type === 'key') {
          if (key && node.value !== key) 
            throw new Error("Google Cloud Datastore: Inconsistent key values in data ('#{key}' != '#{node.value}')");
          key = node.value;
        }
        else if (isSimpleType(descriptor.type) || descriptor.type === 'ref') {
          // XXX support other types than just equality filters
          filters.push({
            propertyFilter: {
              property: {name: descriptor.path.replace('.[]','')},
              operator: 'EQUAL',
              value: JSValueToGCDValue(node.value, descriptor.value)
            }
          });
        }
      }
    }
    
    if (key !== undefined) {
      filters.push({
        propertyFilter: {
          property: {name: '__key__'},
          operator: 'EQUAL',
          value: { keyValue: { pathElement: keyToGCDKey(key) } }
        }
      });
    }
    else if (schema.__parent) {
      filters.push({
        propertyFilter: {
          property: {name: '__key__'},
          operator: 'HAS_ANCESTOR',
          value: { keyValue: { pathElement:keyToGCDKey(schema.__parent) } }
        }
      });
    }
    
    var batchStream = Stream(function(r) {
      // construct query request:
      var request = {query: {}};
      
      if (filters.length == 1) {
        request.query.filter = filters[0];
      }
      else if (filters.length > 1) {
        request.query.filter = {
          compositeFilter: {
            operator: 'AND',
            filter: filters
          }
        };
      }
      
      if (kind) {
        request.query.kind = [{name:kind}];
      }
      
      if (orders.length) {
        request.query.order = orders;
      }
      
      if (idsOnly) {
        request.query.projection = [ { property:{name:'__key__'}}];
      }
      
      //        console.log(require('sjs:debug').inspect(request, false, 20));
      
      while (1) {
        var results = (transaction || context).runQuery(request);
        if (!results.batch || !results.batch.entityResult) break;
        console.log("GCD:query: #{results.batch.entityResult.length} results");
        r(results.batch.entityResult .. 
          map({entity} -> idsOnly ?
              { id:GCDKeyToKey(entity.key.pathElement), 
                schema: GCDKeyToKind(entity.key.pathElement) } :
              GCDEntityToJSEntity(entity, {}, schemas)                
             ));
        
        // XXX not sure this logic is correct; 
        // see https://groups.google.com/d/msg/gcd-discuss/iNs6M1jA2Vw/kn7VVgxQeHkJ
        //console.log(results.batch.moreResults);
        if (results.batch.moreResults != 'NOT_FINISHED' ||!results.batch.endCursor) break;
        request.query.startCursor = results.batch.endCursor; 
      }
    });
    
    // buffer(1) ensures that we already perform the next GCD
    // request while processing results; this is to compensate for
    // GCD's high latency
    return batchStream .. buffer(1); 
  }

  // returns a 'Datastore' object
  var rv = {
    /**
       @function GoogleCloudDatastore.write
       @param {Array} [entities] [datastore::Entity] objects to create/update/delete
       @return {Array} Array of ids of changed entities
       @summary Create/update/delete entities in the datastore
       @desc
          If `entity` is of the form
          
              {  id:     IDENTIFIER_STRING,
                 schema: SCHEMA_NAME,
                 data:   SIMPLE_JS_OBJ
              }

          then the item identified by `id` will be updated with `data` as described by the
          given `schema`. If the item does not exist yet, a new item will be created.

          If `entity` is of the form
 
              {  schema: SCHEMA_NAME,
                 data:   SIMPLE_JS_OBJ
              }

          then a new item with the given `data` as described by `schema` will be created.
          
          If `entity` is of the form

              {  id: IDENTIFIER_STRING,
                 data: null
              }
               
          then the given item will be deleted from the datastore.
     */
    write: unbatched(writeInner),

    /**
       @function GoogleCloudDatastore.read
       @param {flux::Entity} [entity] Entity to retrieve
       @return {flux::Entity} *entity* with `data` attribute set to retrieved data 
               or `null` if the entity could not be found in the datastore
       @summary Read an entity from the datastore
       @desc
          `entity` needs to have an `id` attribute. If `entity` contains a `schema` 
          attribute it will be compared against the stored schema of the retrieved data. 
          If the two don't match an error will be thrown.

          Other attributes on *entity* (e.g. `data`) will be ignored.
          
     */
    read: unbatched(readInner),

    /**
       @function GoogleCloudDatastore.query
       @param {Object} [query_descriptor] Query Descriptor
       @return {sjs::sequence::Stream} Stream of result *batches* (use [sjs:sequence::unpack] to get a stream of results)
       @summary Query for entities
     */
    query: function(query_descriptor) {
      return queryInner(query_descriptor);
    },

    /**
       @function withTransaction
       @altsyntax googleclouddatastore.withTransaction([options]) { |transaction| ... }
       @param {optional Object} [options] Transaction options
       @param {Function} [block]
       @summary Execute *block* with a new [::Transaction] object. The transaction will automatically be rolled back if there is an error during committing.
     */
    withTransaction: function(options, block) {
      if (!block) {
        block = options;
        options = {};
      }

      context.withTransaction(options.isolationLevel) {
        |transaction_context|

        var mutated_ids = {}, deletes = [], upserts = [];

        block({

          read:  unbatched(function(entities) {
            return readInner(entities, transaction_context);
          }),

          write: unbatched(function(entities) { 
            var result = writeInner(entities, transaction_context);

            // make sure we didn't attempt to mutate entities before
            result.ids .. each { 
              |id|
              if (mutated_ids[id]) throw new Error("Cannot mutate entity multiple times within a transaction (#{id})");
              mutated_ids[id] = true;
            }

            deletes = deletes.concat(result.deletes);
            upserts = upserts.concat(result.upserts);

            return result.ids;
          }),

          query: function(entities) { 
            return queryInner(entities, transaction_context) 
          }

        });
        
        // commit deletes and upserts
        var mutation = {};
        if (deletes.length) mutation['delete'] = deletes;
        if (upserts.length) mutation.upsert = upserts;
           
        transaction_context.commit({mutation: mutation});
        change_buffer.addChanges(keys(mutated_ids) .. toArray);
      }
    },

    /**
       @function GoogleCloudDatastore.watch
       @altsyntax gcd.watch { |changed_ids| ... }
       @param {Function} [watcher] Function which will be called with arrays of ids that have changed.
       @summary Watch for changes to entities.
    */
    watch: function(f) {
      var start_revision = change_buffer.revision, current_revision;
      while (true) {
        current_revision = change_buffer.emitter.wait();
        while (current_revision !== start_revision) {
          f(change_buffer.getChanges(start_revision));
          start_revision = current_revision;
          current_revision = change_buffer.revision;
        }
      }
    }


  };

  return rv;
}
exports.GoogleCloudDatastore = GoogleCloudDatastore;
