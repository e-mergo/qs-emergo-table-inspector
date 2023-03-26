/**
 * E-mergo Table Inspector Extension
 *
 * @since 20191019
 * @author Laurens Offereins <https://github.com/lmoffereins>
 *
 * @param  {Object} qlik             Qlik's core API
 * @param  {Object} qvangular        Qlik's Angular implementation
 * @param  {Object} $                jQuery
 * @param  {Object} _                Underscore
 * @param  {Object} $q               Angular's promise library
 * @param  {Object} qUtil            Qlik's utility library
 * @param  {Object} Resize           Qlik's resize API
 * @param  {Object} objectConversion Qlik's object conversion API
 * @param  {Object} props            Property panel definition
 * @param  {Object} initProps        Initial properties
 * @param  {Object} util             E-mergo utility functions
 * @param  {Object} uiUtil           E-mergo interface utility functions
 * @param  {String} css              Extension stylesheet
 * @param  {String} tmpl             Extension template file
 * @return {Object}                  Extension structure
 */
define([
	"qlik",
	"qvangular",
	"jquery",
	"underscore",
	"ng!$q",
	"translator",
	"util",
	"core.utils/resize",
	"objects.extension/object-conversion",
	"client.services/export-dialog/export-dialog",
	"./properties",
	"./initial-properties",
	"./util/util",
	"./util/ui-util",
	"text!./style.css",
	"text!./template.ng.html"
], function( qlik, qvangular, $, _, $q, translator, qUtil, Resize, objectConversion, exportDialog, props, initProps, util, uiUtil, css, tmpl ) {

	// Add global styles to the page
	util.registerStyle("qs-emergo-table-inspector", css);

	/**
	 * Holds the reference to the current app's API
	 *
	 * @type {Object}
	 */
	var app = qlik.currApp(),

	/**
	 * Return the extension scope
	 *
	 * @param  {HTMLElement} element HTML element in extension
	 * @return {Object} Scope
	 */
	getExtensionScopeFromElement = function( element ) {
		return $(element).parents(".qs-emergo-table-inspector").scope();
	},

	/**
	 * Query the app's tables and keys
	 *
	 * @return {Promise} List of app tables
	 */
	getAppTables = function() {

		// Bail when the `engineApp` interface is not available (when embedded)
		if (! app.model.engineApp) {
			return $q.resolve([]);
		}

		return app.model.engineApp.getTablesAndKeys({}, {}, 0, true, false).then( function( tables ) {
			return tables.qtr.filter( function( a ) {

				// Discard synthetic tables
				return ! a.qIsSynthetic;

			}).map( function( a ) {

				// Quick replace synthetic keys
				a.qFields = a.qFields.reduce( function( arr, item ) {
					var add;

					if (item.qOriginalFields.length) {
						add = item.qOriginalFields.map( function( b ) {

							// Original field metadata is not used, so only store the field's name
							return {
								qName: b
							};
						});
					} else {
						add = [item];
					}

					return arr.concat(add);
				}, []);

				return {
					value: a.qName,
					qData: a
				};
			});
		});
	},

	/**
	 * Return the table data for the given table
	 *
	 * @param  {String} tableName Table name
	 * @return {Promise} Table data
	 */
	getAppTableByName = function( tableName ) {
		return getAppTables().then( function( tables ) {
			return tables.find( function( a ) {
				return a.value === tableName;
			});
		});
	},

	/**
	 * Return the table's field names
	 *
	 * @param  {String} tableName Table name
	 * @return {Promise} Table field names
	 */
	getAppTableFieldNames = function( tableName ) {
		return getAppTableByName(tableName).then( function( a ) {
			return a ? a.qData.qFields.map( function( b ) {
				return b.qName;
			}) : [];
		});
	},

	/**
	 * Return picked properties for the table object
	 *
	 * @param  {Object} props Properties
	 * @return {Object}       Picked properties
	 */
	getTablePropsFromObjProps = function( props ) {
		props = _.defaults(props || initProps, initProps);

		var a = _.pick(props, "props", "qHyperCubeDef");

		// Define additional table properties
		a.qHyperCubeDef.qCalcCondition.qCond = { qv: (a.qHyperCubeDef.qDimensions.length || a.qHyperCubeDef.qMeasures.length) ? "" : "0" };
		a.showTitles = true;
		a.title = "Table Inspector - ".concat(a.props.tableName);
		a.subtitle = a.props.removedFields.length ? "Removed fields: ".concat(a.props.removedFields.join(", ")) : "";
		a.totals = { show: true };

		return a;
	},

	/**
	 * Relevant paths for applying patches on the visualization objects
	 *
	 * @type {Array}
	 */
	pathsToPatch = {
		dataTable: [
			"/qHyperCubeDef/qDimensions",
			"/qHyperCubeDef/qMeasures",
			"/qHyperCubeDef/qColumnOrder",
			"/qHyperCubeDef/qInterColumnSortOrder",
			"/qHyperCubeDef/qCalcCondition/qCond/qv",
			"/props/tableName",
			"/props/removedFields",
			"/props/addedMeasures",
			"/title",
			"/subtitle"
		],
		extension: [
			"/qHyperCubeDef/qColumnOrder",
			"/qHyperCubeDef/qInterColumnSortOrder",
			"/props/tableName",
			"/props/tableStructure",
			"/props/exportDimensions",
			"/props/removedFields",
			"/props/addedMeasures"
		]
	},

	/**
	 * Returns a helper that handles the setup of patches for a type of either 'dataTable' or 'extension'
	 *
	 * Fields to patch are defined in the `pathsToPatch` global object.
	 *
	 * @param  {String} type Optional. Type of patch generator. Defaults to 'dataTable'.
	 * @return {Function} Helper for setting up patches for the type
	 */
	getPatcher = function( type ) {
		type = type || "dataTable";

		/*
		 * Setup patches for a list of properties to save
		 *
		 * @param  {Object} props   List of properties to save
		 * @param  {String} path    Optional. Path to patch
		 * @param  {Array}  patches Optional. Set of patches to add to
		 * @return {Array} Patches
		 */
		return function setupPatches( props, path, patches ) {
			props = props || {};
			path = path || "/";
			patches = patches || [];

			for (var i in props) {
				if (props.hasOwnProperty(i)) {
					if ("object" === typeof props[i] && ! Array.isArray(props[i])) {
						getPatcher(type)(props[i], path.concat(i, "/"), patches);
					} else if (-1 !== pathsToPatch[type].indexOf(path.concat(i))) {
						patches.push({
							qOp: "replace",
							qPath: path.concat(i),
							qValue: JSON.stringify(props[i])
						});
					}
				}
			}

			return patches;
		};
	},

	/**
	 * Return the effective properties of an object by id
	 *
	 * @param  {String} id Visualization object id
	 * @return {Promise}    Effective properties
	 */
	getEffectivePropertiesById = function( id ) {

		// Get the extension's object model
		return app.getObject(id).then( function( model ) {
			return model.getEffectiveProperties();
		});
	},

	/**
	 * Update the properties of the visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} props  Properties
	 * @return {Promise} Visualization is updated
	 */
	updateExtensionVisualization = function( $scope, props ) {
		var patcher = getPatcher("extension"), patches;

		// Clear the table structure
		props.props.tableStructure = [];

		// Walk the visualization's dimensions
		props.qHyperCubeDef.qDimensions.forEach( function( a ) {

			// Rebuild the table structure. This property is used to determine whether
			// the table is changed in the datamodel. See `createEmbeddedViz()`.
			props.props.tableStructure.push(a.qDef.qFieldDefs[0]);
		});

		// Define patches from props
		patches = patcher(props);

		// Save changes to the extension's object model
		return $scope.object.model.applyPatches(patches);
	},

	/**
	 * Remove the saved properties from the visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Promise} Visualization is reset
	 */
	resetExtensionVisualization = function( $scope ) {

		// Update the extension's object with initial properties
		return updateExtensionVisualization($scope, util.copy(initProps)).then( function() {

			// Get the table's object
			return app.visualization.get($scope.vizId).then( function( object ) {

				// Break engine connection and destroy scope
				object.close().then( function() {

					// Trigger idle state
					$scope.fsm.close();
				});
			});
		}).catch(console.error);
	},

	/**
	 * Procedure for selecting a data table
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise} Table is selected
	 */
	selectTable = function( $scope, tableData ) {

		// Trigger loading state
		$scope.fsm.select();

		// Update extension's hypercube and properties
		return prepareEmbeddedViz($scope, tableData).then( function( props ) {

			// Create or update the embedded visualization
			var promise = $scope.vizId ? updateEmbeddedViz($scope, props) : createEmbeddedViz($scope, props);

			// When table is created/updated
			promise.then( function() {

				// Trigger table state
				$scope.fsm.open();

				// Get the embedded visualization's properties
				return getEffectivePropertiesById($scope.vizId).then( function( modelProps ) {

					// Keep dimension data for export purposes. This set contains
					// more data than the qDimensions setup in `prepareEmbeddedViz()`.
					props.props.exportDimensions = modelProps.qHyperCubeDef.qDimensions.map( function( a ) {

						// Generate the dimension's id when missing
						if (! a.qDef.cId) {
							a.qDef.cId = qUtil.generateId();
						}

						// Keep the stringify'd version
						return JSON.stringify(a);
					});

					return updateExtensionVisualization($scope, props);
				});
			});
		}).catch(console.error);
	},

	/**
	 * Reset the visualization's hypercube definition
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise} Properties are saved
	 */
	prepareEmbeddedViz = function( $scope, tableData ) {
		var dfd = $q.defer(), newProps = util.copy(initProps);

		// Reset table name and dimensions
		newProps.props.tableName = tableData.value;
		newProps.qHyperCubeDef.qDimensions = [];
		newProps.qHyperCubeDef.qMeasures = [];

		// Reset existing properties
		if ($scope.vizId) {

			// Keep the stored manipulations when preparing the same table
			if ($scope.layout.props.tableName === tableData.value) {
				newProps.props.removedFields = $scope.removedFields;
				newProps.props.addedMeasures = $scope.addedMeasures;
			} else {
				$scope.removedFields = [];
				$scope.addedMeasures = [];
			}

			dfd.resolve();

		// Setup new properties
		} else {

			// Set the stored manipulations. Maybe stored values are present
			newProps.props.removedFields = $scope.removedFields = $scope.layout.props.removedFields || [];
			newProps.props.addedMeasures = $scope.addedMeasures = $scope.layout.props.addedMeasures || [];

			// Get the object's properties
			$scope.object.model.getProperties().then( function( props ) {

				// When available, fetch details from a previously saved table
				if (props.qHyperCubeDef) {
					newProps.qHyperCubeDef.qColumnOrder = props.qHyperCubeDef.qColumnOrder || [];
					newProps.qHyperCubeDef.qInterColumnSortOrder = props.qHyperCubeDef.qInterColumnSortOrder || [];
				}
			}).then(dfd.resolve);
		}

		// Return the prepared properties
		return dfd.promise.then( function() {
			var actualRemovedFields = [], actualAddedMeasures = [];

			// Walk selected table's fields
			tableData.qData.qFields.forEach( function( a ) {

				// Skip removed fields
				if (-1 !== newProps.props.removedFields.indexOf(a.qName)) {
					actualRemovedFields.push(a.qName);
					return;
				}

				// Add field to hypercube
				newProps.qHyperCubeDef.qDimensions.push({
					qDef: {
						qFieldDefs: [a.qName],
						qFieldLabels: [a.qName],
						autoSort: true,
						qSortCriterias: [{
							qSortByAscii: 1
						}]
					}
				});
			});

			// Walk added measures
			newProps.props.addedMeasures.forEach( function( a ) {
				var expression = a.aggregation.replace("$1", qUtil.escapeField(a.field));

				// Skip measures for non-existing fields
				if (-1 === tableData.qData.qFields.map(b => b.qName).indexOf(a.field)) {
					return;
				}

				actualAddedMeasures.push(a);

				// Add measure to hypercube
				newProps.qHyperCubeDef.qMeasures.push({
					qDef: {
						qLabel: expression,
						qDef: expression
					},
					qSortBy: {
						qSortByNumeric: -1
					}
				});
			});

			// Correct the stored manipulations
			newProps.props.removedFields = actualRemovedFields;
			newProps.props.addedMeasures = actualAddedMeasures;

			// Add the fields to ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				var listDiff = newProps.qHyperCubeDef.qDimensions.length + newProps.qHyperCubeDef.qMeasures.length - newProps.qHyperCubeDef[a].length;

				newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].length
					// Use previously defined ordering and sorting lists
					? (0 < listDiff)

						// The new field list is longer
						? newProps.qHyperCubeDef[a].concat(
							_.keys(newProps.qHyperCubeDef.qDimensions.concat(newProps.qHyperCubeDef.qMeasures)).map(Number).slice(newProps.qHyperCubeDef[a].length)
						)

						// The new field list is shorter
						: newProps.qHyperCubeDef[a].filter( function( b ) {
							return b < (newProps.qHyperCubeDef.qDimensions.length + newProps.qHyperCubeDef.qMeasures.length);
						})

					// Define new ordering and sorting lists
					: _.keys(newProps.qHyperCubeDef.qDimensions.concat(newProps.qHyperCubeDef.qMeasures)).map(Number);
			});

			// Save new selections
			return updateExtensionVisualization($scope, newProps).then( function() {
				return newProps;
			});
		}).catch(console.error);
	},

	/**
	 * Create a new embedded visualization object
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Promise} Table is created
	 */
	createEmbeddedViz = function( $scope, props ) {
		var _props = getTablePropsFromObjProps(props);

		// Create viz-on-the-fly with selected patches
		return app.visualization.create("table", [], _props).then( function( object ) {
			var $container = $("#".concat($scope.containerId)),

			// Insert object in the extension's element
			showed = object.show($scope.containerId, {
				/**
				 * Act when the table is rendered
				 *
				 * This fires only when the data model is reloaded or the sheet is (re)build. The
				 * following logic enables auto-updates on removal or adding of fields in the app's
				 * datamodel. Field selections do not affect visualization rendering.
				 *
				 * @return {Void}
				 */
				onRendered: function() {

					// Find the current table structure
					getAppTableFieldNames($scope.layout.props.tableName).then( function( fieldNames ) {
						var prevStructure = _.difference($scope.layout.props.tableStructure, $scope.removedFields),
						    newStructure = _.difference(fieldNames, $scope.removedFields),
						    hasNewStructure = _.difference(prevStructure, newStructure).length || _.difference(newStructure, prevStructure).length;

						// Structure was not found, table removed, so reset the extension visualization
						if (! fieldNames.length){
							resetExtensionVisualization($scope);

						// Structure was changed, so reload the embedded visualization
						} else if (hasNewStructure) {
							reloadEmbeddedViz($scope);
						}
					});
				}
			});

			// Store visualization id for future reference
			$scope.vizId = object.id;

			return showed;
		});
	},

	/**
	 * Updates the embedded visualization object
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} props  Propeprties with updates
	 * @return {Promise} Table is updated
	 */
	updateEmbeddedViz = function( $scope, props ) {
		var dfd = $q.defer(), patcher = getPatcher("dataTable"), patches;

		// Get the table's object model
		return app.getObject($scope.vizId).then( function( model ) {

			// Remove soft patches just before updating
			model.clearSoftPatches();

			// Define patches from props
			patches = patcher(getTablePropsFromObjProps(props));

			// Apply patches
			return model.applyPatches(patches);
		}).catch(console.error);
	},

	/**
	 * Shorthand for updating both the data table and the extension
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} props  Properties with updates
	 * @return {Promise} Table is updated
	 */
	updateEmbeddedVizAndExtension = function( $scope, props ) {
		return updateEmbeddedViz($scope, props).then( function() {
			return updateExtensionVisualization($scope, props);
		});
	},

	/**
	 * Reload the embedded visualization object
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Promise} Table is reloaded
	 */
	reloadEmbeddedViz = function( $scope ) {
		return getAppTableByName($scope.layout.props.tableName).then( function( tableData ) {

			// When reloading, clear the stored manipulations
			$scope.removedFields = [];
			$scope.addedMeasures = [];

			return selectTable($scope, tableData);
		});
	},

	/**
	 * Convert the extension to the embedded visualization
	 *
	 * The embedded visualization's object is not removed in order to
	 * keep the option to use the undo functionality in the app.
	 *
	 * Actual convert logic does exist in the extension context object,
	 * but it is not documented and parameters are unclear:
	 *
	 * $scope.ext._convert(
	 *     visualizations.getType("table"), // How to?
	 *     "table",
	 *     builder.item // How to?
	 * );
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Promise} Extension is converted
	 */
	convertExtensionToEmbeddedViz = function( $scope ) {

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {

			// Populate dimension column id values
			props.qHyperCubeDef.qDimensions = props.qHyperCubeDef.qDimensions.map( function( a ) {
				a.qDef.cId = qUtil.generateId();
				return a;
			});

			// Populate measure column id values
			props.qHyperCubeDef.qMeasures = props.qHyperCubeDef.qMeasures.map( function( a ) {
				a.qDef.cId = qUtil.generateId();
				return a;
			});

			// Remove inspector properties
			delete props.props;

			// Reset metadata
			props.qHyperCubeDef.qCalcCondition = {};
			props.showTitles = true;
			props.title = "";
			props.subtitle = "";

			// Keep the extension's object id
			props.qInfo.qId = $scope.object.model.id;

			// Fully overwrite the extension's properties
			return $scope.object.model.setProperties(props);
		}).catch(console.error);
	},

	/**
	 * Add a field to the embedded visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {String} fieldName Field name
	 * @param  {Number} position Optional. Position where to insert the field.
	 * @return {Promise} Field is added
	 */
	addTableField = function( $scope, tableData, fieldName, position ) {

		// Remove the field from the table's hidden fields list
		$scope.removedFields = _.difference($scope.removedFields, [fieldName]);

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					tableName: tableData.value,
					removedFields: $scope.removedFields,
					addedMeasures: $scope.addedMeasures
				}
			};

			// Add field to the dimension list
			newProps.qHyperCubeDef.qDimensions.push({
				qDef: {
					qFieldDefs: [fieldName],
					qFieldLabels: [fieldName],
					autoSort: true,
					qSortCriterias: [{
						qSortByAscii: 1
					}]
				}
			});

			// Add the field to ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				var ix = newProps.qHyperCubeDef.qDimensions.length - 1;

				// Update field indices considering trailing measures
				newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].map( function( b ) {
					return b < ix ? b : b + 1;
				});

				// Add field at position
				if ("undefined" === typeof position) {
					newProps.qHyperCubeDef[a].push(ix);
				} else {
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].slice(0, position + 1).concat(ix, newProps.qHyperCubeDef[a].slice(position + 1));
				}
			});

			// Update props on the table and extension
			return updateEmbeddedVizAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Add all removed fields to the embedded visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Number} position Optional. Position where to insert the field.
	 * @return {Promise} Fields are added
	 */
	addAllTableFields = function( $scope, tableData, position ) {

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					tableName: tableData.value,
					removedFields: [],
					addedMeasures: $scope.addedMeasures
				}
			};

			// Walk the removed fields
			$scope.removedFields.forEach( function( a, num ) {

				// Add field to the dimension list
				newProps.qHyperCubeDef.qDimensions.push({
					qDef: {
						qFieldDefs: [a],
						qFieldLabels: [a],
						autoSort: true,
						qSortCriterias: [{
							qSortByAscii: 1
						}]
					}
				});

				// Add the field to ordering and sorting lists
				["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
					var ix = newProps.qHyperCubeDef.qDimensions.length - 1;

					// Update field indices
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].map( function( b ) {
						return b < ix ? b : b + 1;
					});

					// Add field at position
					if ("undefined" === typeof position) {
						newProps.qHyperCubeDef[a].push(ix);
					} else {
						newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].slice(0, position + num + 1).concat(ix, newProps.qHyperCubeDef[a].slice(position + num + 1));
					}
				});
			});

			// Clear the table's hidden fields list after they were added
			$scope.removedFields = [];

			// Update props on the table and extension
			return updateEmbeddedVizAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Remove a field from the embedded visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {String} fieldName Field name
	 * @return {Promise} Field is hidden
	 */
	removeTableField = function( $scope, tableData, fieldName ) {

		// Add the field to the table's hidden fields list
		$scope.removedFields = _.uniq($scope.removedFields.concat([fieldName]));

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					tableName: tableData.value,
					removedFields: $scope.removedFields,
					addedMeasures: $scope.addedMeasures
				}
			},

			// Find field in hypercube
			ix = newProps.qHyperCubeDef.qDimensions.findIndex( function( a ) {
				return a.qDef.qFieldDefs[0] === fieldName;
			});

			// Field is found
			if (-1 !== ix) {

				// Remove the field from the dimension list
				newProps.qHyperCubeDef.qDimensions.splice(ix, 1);

				// Remove the field from ordering and sorting lists
				["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
						return b !== ix;
					}).map( function( b ) {
						return b < ix ? b : b - 1;
					});
				});

				// Update props on the table and extension
				return updateEmbeddedVizAndExtension($scope, newProps);
			}
		}).catch(console.error);
	},

	/**
	 * Remove all columns but the indicated field from the embedded visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {String} fieldName Field name
	 * @param  {Number} position Optional. Required when removing with direction
	 * @param  {Number} direction Optional. Removal direction, -1 for left, 1 for right
	 * @return {Promise} Fields are hidden
	 */
	removeOtherTableColumns = function( $scope, tableData, fieldName, position, direction ) {
		direction = direction || 0;

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {
			var ix, fieldIndicesToRemove, qDimensions, qMeasures, newProps;

			// Remove with direction
			if (direction) {

				// Find field in hypercube
				ix = props.qHyperCubeDef.qColumnOrder.find( function( a, ix ) {
					return ix === position;
				});

				// Get field indices to remove
				fieldIndicesToRemove = direction > 0 ? props.qHyperCubeDef.qColumnOrder.slice(position + 1) : props.qHyperCubeDef.qColumnOrder.slice(0, position);

				// Remove fields from the dimension list
				qDimensions = props.qHyperCubeDef.qDimensions.filter( function( a, ix ) {
					return -1 === fieldIndicesToRemove.indexOf(ix);
				});

				// Remove fields from the measure list
				qMeasures = props.qHyperCubeDef.qMeasures.filter( function( a, ix ) {
					return -1 === fieldIndicesToRemove.map(a => a - props.qHyperCubeDef.qDimensions.length).indexOf(ix);
				});

				// Add left/right fields to the table's hidden fields list
				$scope.removedFields = _.uniq($scope.removedFields.concat(props.qHyperCubeDef.qDimensions.filter( function( a, ix ) {
					return -1 !== fieldIndicesToRemove.indexOf(ix);
				}).map( function( a ) {
					return a.qDef.qFieldDefs[0];
				})));

				// Remove measures
				$scope.addedMeasures = $scope.addedMeasures.filter( function( a, ix ) {
					return -1 === fieldIndicesToRemove.map(a => a - props.qHyperCubeDef.qDimensions.length).indexOf(ix);
				});

			// Remove all other fields
			} else {

				// Find field in hypercube
				ix = props.qHyperCubeDef.qDimensions.findIndex( function( a ) {
					return a.qDef.qFieldDefs[0] === fieldName;
				});

				// Get field indices to remove
				fieldIndicesToRemove = props.qHyperCubeDef.qDimensions.map( function( a, ix ) {
					return ix;
				}).filter( function( a ) {
					return a !== ix;
				});

				// Keep the field from the dimension list
				qDimensions = props.qHyperCubeDef.qDimensions.splice(ix, 1);

				// Remove all measures
				qMeasures = [];

				// Add all other fields to the table's hidden fields list
				$scope.removedFields = _.difference(_.uniq($scope.removedFields.concat(_.pluck(tableData.qData.qFields, "qName"))), [fieldName]);

				// Remove other manipulations
				$scope.addedMeasures = [];
			}

			// Define new table properties
			newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					tableName: tableData.value,
					removedFields: $scope.removedFields,
					addedMeasures: $scope.addedMeasures
				}
			};

			// Field is found
			if (-1 !== ix) {

				// Set the new dimension and measure lists
				newProps.qHyperCubeDef.qDimensions = qDimensions;
				newProps.qHyperCubeDef.qMeasures = qMeasures;

				// Remove the field from ordering and sorting lists
				["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
						return -1 === fieldIndicesToRemove.indexOf(b);
					}).map( function( b ) {
						return b - fieldIndicesToRemove.filter(a => a < b).length;
					});
				});

				// Update props on the table and extension
				return updateEmbeddedVizAndExtension($scope, newProps);
			}
		}).catch(console.error);
	},

	/**
	 * Add a measure to the embedded visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Object} measure Measure details
	 * @param  {Number} position Optional. Position where to insert the measure.
	 * @return {Promise} Measure is added
	 */
	addTableMeasure = function( $scope, tableData, measure, position ) {

		// Add the measure to the table's added measures list
		$scope.addedMeasures = $scope.addedMeasures.concat(measure);

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					tableName: tableData.value,
					removedFields: $scope.removedFields,
					addedMeasures: $scope.addedMeasures
				}
			},

			// Prepare measure expression
			expression = measure.aggregation.replace("$1", qUtil.escapeField(measure.field));

			// Add measure to the measures list
			newProps.qHyperCubeDef.qMeasures.push({
				qDef: {
					qLabel: expression,
					qDef: expression
				},
				qSortBy: {
					qSortByNumeric: -1
				}
			});

			// Add the measure to ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				var ix = newProps.qHyperCubeDef.qDimensions.length + newProps.qHyperCubeDef.qMeasures.length - 1;

				// Add field at position
				if ("undefined" === typeof position) {
					newProps.qHyperCubeDef[a].push(ix);
				} else {
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].slice(0, position + 1).concat(ix, newProps.qHyperCubeDef[a].slice(position + 1));
				}
			});

			// Update props on the table and extension
			return updateEmbeddedVizAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Remove a measure from the embedded visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Number} position Position at which to remove the measure
	 * @return {Promise} Measure is removed
	 */
	removeTableMeasure = function( $scope, tableData, position ) {

		// Removing one is equal to removing all
		if (1 === $scope.addedMeasures.length) {
			return removeAllTableMeasures($scope, tableData);
		}

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					tableName: tableData.value,
					removedFields: $scope.removedFields,
					addedMeasures: $scope.addedMeasures
				}
			},

			// Find measure in columns
			colNum = newProps.qHyperCubeDef.qColumnOrder.length > position ? newProps.qHyperCubeDef.qColumnOrder[position] : -1,

			// Find measure in hypercube
			ix = -1 !== colNum ? colNum - newProps.qHyperCubeDef.qDimensions.length : -1;

			// Measure is found
			if (-1 !== ix) {

				// Remove the measure from the table's added measures list
				$scope.addedMeasures.splice(ix, 1);
				newProps.props.addedMeasures = $scope.addedMeasures;

				// Remove the measure from the measure list
				newProps.qHyperCubeDef.qMeasures.splice(ix, 1);

				// Remove the field from ordering and sorting lists
				["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
						return b !== colNum;
					}).map( function( b ) {
						return b < colNum ? b : b - 1;
					});
				});

				// Update props on the table and extension
				return updateEmbeddedVizAndExtension($scope, newProps);
			}
		}).catch(console.error);
	},

	/**
	 * Remove all measures from the embedded visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise} Measures are removed
	 */
	removeAllTableMeasures = function( $scope, tableData ) {

		// Clear the table's added measures list
		$scope.addedMeasures = [];

		// Get the embedded visualization's properties
		return getEffectivePropertiesById($scope.vizId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					tableName: tableData.value,
					removedFields: $scope.removedFields,
					addedMeasures: []
				}
			},

			// Get dimension count
			dimensionCount = newProps.qHyperCubeDef.qDimensions.length;

			// Clear measures in hypercube
			newProps.qHyperCubeDef.qMeasures = [];

			// Remove the measures from ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
					return b < dimensionCount;
				}).map( function( b ) {
					return b < dimensionCount ? b : b - 1;
				});
			});

			// Update props on the table and extension
			return updateEmbeddedVizAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Extension controller function
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} $el Scope's jQuery element
	 * @return {Void}
	 */
	controller = ["$scope", "$element", function( $scope, $el ) {

		/**
		 * Define the app popover
		 *
		 * @return {Object} Popover methods
		 */
		var popover = uiUtil.uiSearchableListPopover({
			title: translator.get("DataManager.Filter.Tabs.Tables"),
			get: function( setItems ) {
				getAppTables().then( function( tables ) {
					setItems(tables);
				});
			},
			select: function( item ) {
				selectTable($scope, item);
			},
			alignTo: function() {
				return $el.find(".open-button")[0];
			},
			closeOnEscape: true,
			outsideIgnore: ".open-button",
			dock: "right"
		});

		/**
		 * Define a three-tiered state-machine for handling events
		 *
		 * @type {StateMachine}
		 */
		$scope.fsm = new util.StateMachine({
			name: "emergoTableInspector",
			transitions: [{
				from: "IDLE", to: "LOADING", name: "SELECT"
			}, {
				from: "LOADING", to: "TABLE", name: "OPEN"
			}, {
				from: "LOADING", to: "IDLE", name: "CLOSE"
			}, {
				from: "TABLE", to: "LOADING", name: "SELECT"
			}, {
				from: "TABLE", to: "IDLE", name: "CLOSE"
			}],
			on: {
				enterLoading: function( lifecycle ) {
					$scope.loading = true;
				},
				leaveLoading: function( lifecycle ) {
					$scope.loading = false;
				},
				enterIdle: function( lifecycle ) {

					// Clear inner html
					$("#".concat($scope.containerId)).empty();

					// Detach id from scope
					$scope.vizId = undefined;
				}
			}
		});

		// Container id
		$scope.containerId = "qs-emergo-table-inspector-".concat($scope.$id);

		// Removed fields
		$scope.removedFields = $scope.layout.removedFields || [];

		// Added measures
		$scope.addedMeasures = $scope.layout.addedMeasures || [];

		// Initiate first data table when set
		getAppTableByName($scope.layout.props.tableName).then( function( tableData ) {

			// Select the table when found
			if (tableData) {
				selectTable($scope, tableData);
			}
		});

		/**
		 * Switch to Analysis mode
		 *
		 * @return {Void}
		 */
		$scope.switchToAnalysis = function() {
			qlik.navigation.setMode(qlik.navigation.ANALYSIS);

			// Open the app popover after the mode is fully switched
			qvangular.$rootScope.$$postDigest($scope.open);
		};

		/**
		 * Return whether the extension can be converted
		 *
		 * @return {Boolean} Can convert the extension
		 */
		$scope.canConvertToTable = function() {
			return $scope.addedMeasures.length || $scope.layout.props && $scope.layout.props.tableStructure.length;
		};

		/**
		 * Convert extension to table
		 *
		 * @return {Void}
		 */
		$scope.convertToTable = function() {
			if ($scope.canConvertToTable()) {
				convertExtensionToEmbeddedViz($scope);
			}
		};

		/**
		 * Button select handler
		 *
		 * @return {Void}
		 */
		$scope.open = function() {
			if (! $scope.object.inEditState() && ! $scope.options.noInteraction && ! $scope.vizId) {
				popover.isActive() ? popover.close() : popover.open();
			}
		};

		// Map popover.isActive() to scope
		$scope.isActive = popover.isActive;

		// Close popover on window resize
		Resize.on("start", popover.close);

		/**
		 * Clean up when the controller is destroyed
		 *
		 * @return {Void}
		 */
		$scope.$on("$destroy", function() {
			Resize.off("start", popover.close);
			popover.close();
		});
	}],

	/**
	 * Return the element's straight table cell's scope
	 *
	 * @param  {Element} element HTML element to find its cell scope for
	 * @return {Object} The cell's scope
	 */
	getTableCellScope = function( element ) {
		var cellClasses = ".qv-st-data-cell, .qv-st-header-cell",
		    $element = $(element);

		return $element.is(cellClasses) ? $element.scope() : $element.parents(cellClasses).scope();
	},

	/**
	 * Holds the list of available measures
	 *
	 * @type {Array}
	 */
	measureList = {
		basicAggregration: {
			label: "Basic aggregation",
			options: [
				"Max($1)",
				"Min($1)",
				"Mode($1)",
				"Only($1)",
				"Sum($1)"
			],
		},
		counterAggegration: {
			label: "Counter aggregation",
			options: [
				"Count($1)",
				"Count(Distinct $1)",
				"MissingCount($1)",
				"MissingCount(Distinct $1)",
				"NullCount($1)",
				"NullCount(Distinct $1)",
				"NumericCount($1)",
				"NumericCount(Distinct $1)",
				"TextCount($1)",
				"TextCount(Distinct $1)"
			],
		},
		statisticalAggegration: {
			label: "Statistical aggregation",
			options: [
				"Avg($1)",
				"Kurtosis($1)",
				"Median($1)",
				"Skew($1)",
				"Stdev($1)",
				"Sterr($1)"
			],
		},
		stringAggegration: {
			label: "String aggregation",
			options: [
				"Concat(Distinct $1, ', ')",
				"MaxString($1)",
				"MinString($1)"
			],
		}
	},

	/**
	 * Holds the list of available quick measures
	 *
	 * @type {Array}
	 */
	quickMeasureList = [
		"Sum($1)",
		"Count($1)",
		"Count(Distinct $1)"
	],

	/**
	 * Modify the extension's context menu
	 *
	 * @param  {Object} object Extension object
	 * @param  {Object} menu   Menu container
	 * @param  {Object} $event HTML event data
	 * @return {Void}
	 */
	getContextMenu = function( object, menu, $event ) {
		/**
		 * Holds the extension's scope object
		 *
		 * @type {Object}
		 */
		var $scope = getExtensionScopeFromElement($event.target),

		/**
		 * Add a new table menu item to the provided menu
		 *
		 * @param  {Object} menu Menu to add to
		 * @param  {Object} a    Table data
		 * @return {Void}
		 */
		addTableMenuItem = function( menu, a ) {
			menu.addItem({
				label: a.value,
				tid: a.value,
				icon: "lui-icon lui-icon--table",
				select: function() {
					selectTable($scope, a);
				}
			});
		},

		/**
		 * Add a new measure menu item to the provided menu
		 *
		 * @param  {Object} menu Menu to add to
		 * @param  {Object} table Table context
		 * @param  {Object} fieldName Field name
		 * @param  {Object} colIndex Optional. Column index
		 * @return {Void}
		 */
		addMeasureMenuItems = function( menu, table, fieldName, colIndex ) {
			var i, j, mmenu;

			// Add quick measures
			quickMeasureList.forEach( function( aggregation, ix ) {
				menu.addItem({
					label: aggregation.replace("$1", qUtil.escapeField(fieldName)),
					tid: "add-measure-quick-".concat(ix),
					select: function() {
						addTableMeasure($scope, table, {
							aggregation: aggregation,
							field: fieldName
						}, colIndex);
					}
				});
			});

			for (i in measureList) {
				if (measureList.hasOwnProperty(i)) {

					// Add aggregation type menu
					mmenu = menu.addItem({
						label: measureList[i].label,
						tid: i
					});

					// Add aggregation options
					measureList[i].options.forEach( function( aggregation, ix ) {
						mmenu.addItem({
							label: aggregation.replace("$1", qUtil.escapeField(fieldName)),
							tid: "add-measure-".concat(i.toLowerCase(), "-", ix),
							select: function() {
								addTableMeasure($scope, table, {
									aggregation: aggregation,
									field: fieldName
								}, colIndex);
							}
						});
					});
				}
			}
		};

		// When we're in Edit mode
		if (object.inEditState()) {

			// When the embedded visualization is active
			if ($scope.vizId) {

				// Convert to table
				menu.addItem({
					translation: ["contextMenu.convertTo", "Table"],
					tid: "convert-to-table",
					icon: "lui-icon lui-icon--table",
					select: function() {
						convertExtensionToEmbeddedViz($scope);
					}
				});
			}

			// Bail when done
			return;
		}

		// Query tables, then add menu items
		getAppTables().then( function( tables ) {

			// When the embedded visualization is active
			if ($scope.vizId) {

				/**
				 * Holds the Switch table menu
				 *
				 * @type {Object}
				 */
				var switchTableMenu,

				/**
				 * Holds the Add field menu
				 *
				 * @type {Object}
				 */
				addFieldMenu,

				/**
				 * Holds the Remove column menu
				 *
				 * @type {Object}
				 */
				removeColumnMenu,

				/**
				 * Holds the menu items for the Remove column menu
				 *
				 * @type {Array}
				 */
				removeColumnMenuItems = [],

				/**
				 * Holds the Add measure menu
				 *
				 * @type {Object}
				 */
				addMeasureMenu,

				/**
				 * Holds the selected table
				 *
				 * @type {Object}
				 */
				selectedTable = tables.find( function( a ) {
					return a.value === object.layout.props.tableName;
				}),

				/**
				 * Holds the removed fields
				 *
				 * @type {Array}
				 */
				removedFields = object.layout.props.removedFields,

				/**
				 * Holds the cell's scope
				 *
				 * @type {Object}
				 */
				$cellScope = getTableCellScope($event.target) || {},

				/**
				 * Holds the cell's cell data
				 *
				 * @type {Object}
				 */
				cell = $cellScope.cell || $cellScope.header || {},

				/**
				 * Holds the list of table columns
				 *
				 * Column indices are corrected for non-data columns.
				 *
				 * @type {Array}
				 */
				columns = $cellScope.grid ? $cellScope.grid.headerRows[0].cells.filter( function( a ) {
					return (a.isDimension || a.isMeasure) && ! a.isSearchIcon;
				}).map( function( a, ix ) {
					a.colIx = ix;
					return a;
				}) : [],

				/**
				 * Holds the cell's column data
				 *
				 * @type {Object}
				 */
				column = columns.length ? columns.find( function( a ) {
					return a.dataColIx === cell.dataColIx;
				}) || {} : {};

				// Copy cell value
				if (cell.text) {
					menu.addItem({
						translation: "contextMenu.copyCellValue",
						tid: "copy-cell-context-item",
						icon: "lui-icon lui-icon--copy",
						select: function() {
							util.copyToClipboard(cell.text);
						}
					});
				}

				// Reset inspector
				menu.addItem({
					label: "Reset inspector",
					tid: "reset-inspector",
					icon: "lui-icon lui-icon--close",
					select: function() {
						resetExtensionVisualization($scope);
					}
				});

				// Switch to another table
				switchTableMenu = menu.addItem({
					label: "Switch table",
					tid: "switch-table",
					icon: "lui-icon lui-icon--table"
				});

				// Each single table
				tables.forEach( function( a ) {

					// Reload the current table
					if (a.value === selectedTable.value) {
						switchTableMenu.addItem({
							label: a.value,
							tid: "reload-table",
							icon: "lui-icon lui-icon--reload",
							select: function() {
								reloadEmbeddedViz($scope);
							}
						});

					// Switch to other table
					} else {
						addTableMenuItem(switchTableMenu, a);
					}
				});

				// Add fields
				if (removedFields.length) {

					// Multiple fields are removed
					if (removedFields.length > 1) {
						addFieldMenu = menu.addItem({
							label: "Add field",
							tid: "add-field",
							icon: "lui-icon lui-icon--paste"
						});

						// All fields
						addFieldMenu.addItem({
							label: "Add all fields",
							tid: "add-all-fields",
							select: function() {
								addAllTableFields($scope, selectedTable, cell.colIx);
							}
						});

						// Each single field
						selectedTable.qData.qFields.filter( function( a ) {
							return -1 !== removedFields.indexOf(a.qName);
						}).forEach( function( a ) {
							addFieldMenu.addItem({
								label: a.qName,
								tid: "add-field-".concat(a.qName),
								select: function() {
									addTableField($scope, selectedTable, a.qName, cell.colIx);
								}
							});
						});

					// Add single field
					} else {
						menu.addItem({
							label: "Add field '".concat(removedFields[0], "'"),
							tid: "add-field",
							icon: "lui-icon lui-icon--paste",
							select: function() {
								addTableField($scope, selectedTable, removedFields[0], cell.colIx);
							}
						});
					}
				}

				// The maximum column index
				var maxColIx = columns.reduce( function( max, a ) {
					return a.colIx > max ? a.colIx : max;
				}, 0);

				// Remove all other fields
				if (column.isDimension) {
					removeColumnMenuItems.push({
						label: "Remove all columns but '".concat(column.fieldName, "'"),
						tid: "remove-other-fields",
						select: function() {
							removeOtherTableColumns($scope, selectedTable, column.fieldName);
						}
					});
				}

				// Remove left columns
				if (cell.colIx > 0) {
					removeColumnMenuItems.push({
						label: "Remove all columns to the left",
						tid: "remove-left-columns",
						select: function() {
							removeOtherTableColumns($scope, selectedTable, column.fieldName, cell.colIx, -1);
						}
					});
				}

				// Remove right columns
				if (cell.colIx < maxColIx) {
					removeColumnMenuItems.push({
						label: "Remove all columns to the right",
						tid: "remove-right-columns",
						select: function() {
							removeOtherTableColumns($scope, selectedTable, column.fieldName, cell.colIx, 1);
						}
					});
				}

				// Add measure
				if (! column.isMeasure) {
					addMeasureMenu = menu.addItem({
						label: "Add measure",
						tid: "add-measure",
						icon: "lui-icon lui-icon--bar-chart"
					});

					// Add single field measures
					if (column.isDimension) {
						addMeasureMenuItems(addMeasureMenu, selectedTable, column.fieldName, cell.colIx);

					// Add all field measures
					} else {
						selectedTable.qData.qFields.forEach( function( a ) {
							var addMeasureFieldMenu = addMeasureMenu.addItem({
								label: a.qName,
								tid: "add-measure-".concat(a.qName)
							});

							addMeasureMenuItems(addMeasureFieldMenu, selectedTable, a.qName);
						});
					}
				}

				// Remove all measures. Don't show when the context is the only measure
				if ($scope.addedMeasures.length && ! (column.isMeasure && 1 === $scope.addedMeasures.length)) {
					removeColumnMenuItems.push({
						label: "Remove all measures",
						tid: "remove-all-measures",
						select: function() {
							removeAllTableMeasures($scope, selectedTable);
						}
					});
				}

				// Remove columns
				if (removeColumnMenuItems.length) {
					removeColumnMenu = menu.addItem({
						label: "Remove column",
						tid: "remove-column",
						icon: "lui-icon lui-icon--cut"
					});

					// Each single field
					selectedTable.qData.qFields.filter( function( a ) {
						return -1 === removedFields.indexOf(a.qName);
					}).forEach( function( a ) {
						removeColumnMenuItems.push({
							label: a.qName,
							tid: "remove-field-".concat(a.qName),
							select: function() {
								removeTableField($scope, selectedTable, a.qName);
							}
						});
					});

					// Add remove items
					removeColumnMenuItems.forEach( function( a ) {
						removeColumnMenu.addItem(a);
					});
				}

				// Remove this field
				if (column.isDimension) {
					menu.addItem({
						label: "Remove field '".concat(column.fieldName, "'"),
						tid: "remove-this-field",
						icon: "lui-icon lui-icon--cut",
						select: function() {
							removeTableField($scope, selectedTable, column.fieldName);
						}
					});

				// Remove measure
				} else if (column.isMeasure) {
					menu.addItem({
						label: "Remove measure '".concat(column.text, "'"),
						tid: "remove-this-measure",
						icon: "lui-icon lui-icon--cut",
						select: function() {
							removeTableMeasure($scope, selectedTable, cell.colIx);
						}
					});
				}

				// Export data
				menu.addItem({
					translation: "contextMenu.export",
					tid: "export",
					icon: "lui-icon lui-icon--export",
					select: function() {
						app.getObject($scope.vizId).then( function( model ) {

							// Open export modal
							exportDialog.show(model);
						});
					}
				});
			} else {

				// Add selectable tables
				if (tables.length > 4) {
					var selectTableMenu = menu.addItem({
						label: "Select table",
						tid: "select-table",
						icon: "lui-icon lui-icon--table",
					});

					tables.forEach( function( a ) {
						addTableMenuItem(selectTableMenu, a);
					});
				} else {
					tables.forEach( function( a ) {
						addTableMenuItem(menu, a);
					});
				}
			}
		}).catch(console.error);
	},

	/**
	 * Handle conversions from a different visualization type
	 *
	 * @param  {Object} exportedFmt Export model from the originating visualization
	 * @param  {Object} initialProperties Initial properties of this extension
	 * @param  {Object} ext Extension object
	 * @param  {String} hyperCubePath Hypercube path (?)
	 * @return {Object} Export model
	 */
	importProperties = function( exportedFmt, initialProperties, ext, hyperCubePath ) {
		var retval = objectConversion.hypercube.importProperties.apply(this, arguments);

		// Overwrite title properties
		retval.qProperty.showTitles = initProps.showTitles || false;
		retval.qProperty.title = initProps.title;
		retval.qProperty.subtitle = initProps.subtitle;

		return retval;
	},

	/**
	 * Handle conversions to a different visualization type
	 *
	 * @param  {Object} propertyTree  Property tree of the current extension
	 * @param  {String} hyperCubePath Hypercube path (?)
	 * @return {Object} Export model
	 */
	exportProperties = function( propertyTree, hyperCubePath ) {
		var retval = objectConversion.hypercube.exportProperties.apply(this, arguments);

		// Add fields as dimensions
		propertyTree.qProperty.props.exportDimensions.forEach( function( fieldData ) {
			var field = JSON.parse(fieldData);

			// Include field when not removed
			if (-1 === propertyTree.qProperty.props.removedFields.indexOf(field.qDef.qFieldDefs[0])) {
				retval.data[0].dimensions.push(field);
			}
		});

		// Remove export dimensions property
		delete propertyTree.qProperty.props.exportDimensions;

		// Add measures
		propertyTree.qProperty.props.addedMeasures.forEach( function( measure ) {
			var expression = measure.aggregation.replace("$1", qUtil.escapeField(measure.field));

			// Include measure
			retval.data[0].measures.push({
				qDef: {
					cId: qUtil.generateId(),
					qLabel: expression,
					qDef: expression
				},
				qSortBy: {
					qSortByNumeric: -1
				}
			});
		});

		// Reset metadata
		retval.properties.showTitles = true;
		retval.properties.title = "";
		retval.properties.subtitle = "";

		return retval;
	};

	return {
		definition: props,
		initialProperties: initProps,
		template: tmpl,
		controller: controller,
		getContextMenu: getContextMenu,
		importProperties: importProperties,
		exportProperties: exportProperties,

		/**
		 * Setup listeners and watchers when the object is mounted
		 *
		 * @return {Void}
		 */
		mounted: function() {},

		/**
		 * Clean-up before the extension object is destroyed
		 *
		 * @return {Void}
		 */
		beforeDestroy: function() {
			var $scope = this.$scope;

			// Get the embedded visualization
			if ($scope.vizId) {
				app.getObject($scope.vizId).then( function( model ) {

					// Break engine connection and destroy scope
					model.close();
				});
			}
		},

		support: {
			cssScaling: false,
			sharing: false,
			snapshot: false,
			export: false,
			exportData: false // This applies for the app inspector. Data export is supported for the embedded visualization
		}
	};
});
