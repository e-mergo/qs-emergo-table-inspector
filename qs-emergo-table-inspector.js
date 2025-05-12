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
 * @param  {Object} Resize           Qlik's resize API
 * @param  {Object} objectConversion Qlik's object conversion API
 * @param  {Object} props            Property panel definition
 * @param  {Object} initProps        Initial properties
 * @param  {Object} qUtil            Imported Qlik utility library
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
	"core.utils/resize",
	"objects.extension/object-conversion",
	"client.services/export-dialog/export-dialog",
	"./properties",
	"./initial-properties",
	"./util/qlik-util",
	"./util/util",
	"./util/ui-util",
	"text!./style.css",
	"text!./template.ng.html"
], function( qlik, qvangular, $, _, $q, translator, Resize, objectConversion, exportDialog, props, initProps, qUtil, util, uiUtil, css, tmpl ) {

	// Add global styles to the page
	util.registerStyle("qs-emergo-table-inspector", css);

	/**
	 * Holds the reference to the current app's API
	 *
	 * @type {Object}
	 */
	var app = qlik.currApp(),

	/**
	 * Holds the app's current theme data
	 *
	 * @type {Object}
	 */
	currTheme,

	/**
	 * Return a modified font size for em
	 *
	 * @param  {String} fontSize Font size in px
	 * @return {String}          Font size in em
	 */
	getFontSizeInEm = function( fontSize ) {
		return "".concat(parseInt(fontSize, 10) / 13, "em");
	},

	/**
	 * Return a getter function for a theme's style
	 *
	 * @param  {String} objectPath Path to theme object
	 * @return {Function}          Style property getter
	 */
	themeStyleGetter = function( objectPath ) {
		/**
		 * Return the value of a theme's style part
		 *
		 * @param  {String} partPath Path to object part
		 * @param  {String} style    Style property name
		 * @return {String}          Style property value
		 */
		return function getThemeStyle( partPath, style ) {
			var themeObject = _.get(currTheme || {}, "properties.".concat(objectPath).split(".")),
			    styleValue = _.get(themeObject, partPath.concat(".", style).split("."));

			// Default to generic object style
			if (! styleValue) {
				styleValue = _.get(_.get(currTheme || {}, ["properties", "object"]), partPath.concat(".", style).split("."));
			}

			// Default to global style
			if (! styleValue) {
				styleValue = _.get(_.get(currTheme || {}, ["properties"]), [style]);
			}

			return styleValue || "";
		};
	},

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
	 * @return {Promise}          Table data
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
	 * @return {Promise}          Table field names
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
	 * @param  {Object} objProps Properties
	 * @return {Object}          Picked properties
	 */
	getInspectorTablePropsFromObjProps = function( objProps ) {
		var newProps = _.pick(objProps, "qHyperCubeDef", "props");

		// Define additional table properties
		newProps.qHyperCubeDef.qCalcCondition.qCond = { qv: (newProps.qHyperCubeDef.qDimensions.length || newProps.qHyperCubeDef.qMeasures.length) ? "" : "0" };
		newProps.showTitles = true;
		newProps.props && newProps.props.tableName && (newProps.title = "Table Inspector - ".concat(newProps.props.tableName));
		newProps.props && newProps.props.removedFields && (newProps.subtitle = newProps.props.removedFields.length ? "Removed fields: ".concat(newProps.props.removedFields.join(", ")) : "");
		newProps.totals = { show: true };

		return newProps;
	},

	/**
	 * Relevant paths for applying patches on the visualization objects
	 *
	 * @type {Array}
	 */
	pathsToPatch = {
		inspectorTable: [
			"/qHyperCubeDef/qDimensions",
			"/qHyperCubeDef/qMeasures",
			"/qHyperCubeDef/qColumnOrder",
			"/qHyperCubeDef/qInterColumnSortOrder",
			"/qHyperCubeDef/qCalcCondition/qCond/qv",
			"/title",
			"/subtitle"
		],
		extension: [
			"/qHyperCubeDef/qColumnOrder",
			"/qHyperCubeDef/qInterColumnSortOrder",
			"/props/tableName",
			"/props/tableStructure",
			"/props/tableDimensions",
			"/props/removedFields",
			"/props/addedMeasures"
		]
	},

	/**
	 * Returns a helper that handles the setup of patches for a type of either 'inspectorTable' or 'extension'
	 *
	 * Fields to patch are defined in the `pathsToPatch` global object.
	 *
	 * @param  {String} type Optional. Type of patch generator. Defaults to 'inspectorTable'.
	 * @return {Function}    Helper for setting up patches for the type
	 */
	getPatcher = function( type ) {
		type = type || "inspectorTable";

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
	 * @param  {Object} props  Properties to update
	 * @return {Promise}       Visualization is updated
	 */
	updateExtensionVisualization = function( $scope, props ) {
		var patcher = getPatcher("extension"), patches;

		// Ensure set of sub properties
		props.props = props.props || {};

		// When updating dimensions
		if (props.qHyperCubeDef && props.qHyperCubeDef.qDimensions) {

			// Clear the table structure
			props.props.tableStructure = [];

			// Walk the visualization's dimensions
			props.qHyperCubeDef.qDimensions.filter(a => a.isField).forEach( function( a ) {

				// Rebuild the table structure. This property is used to determine whether
				// the table is changed in the datamodel. See `createInspectorTableVisualization()`.
				props.props.tableStructure.push(a.qDef.qFieldDefs[0]);
			});
		}

		// Define patches from props
		patches = patcher(props);

		// Save changes to the extension's object model
		return $scope.object.model.applyPatches(patches);
	},

	/**
	 * Remove the saved properties from the visualization
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Promise}       Visualization is reset
	 */
	resetExtensionVisualization = function( $scope ) {

		// Update the extension's object with initial properties
		return updateExtensionVisualization($scope, util.copy(initProps)).then( function() {
			return $scope.fsm.close();
		}).catch(console.error);
	},

	/**
	 * Procedure for selecting a data table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise}          Table is selected
	 */
	selectTable = function( $scope, tableData ) {

		// Update extension's hypercube and properties
		return prepareInspectorTableVisualization($scope, tableData).then( function( props ) {

			// Create or update the inspector table
			return $scope.tableInspectorId ? updateInspectorTableVisualization($scope, props) : createInspectorTableVisualization($scope, props);

		}).catch(console.error);
	},

	/**
	 * Return the parsed expression
	 *
	 * @param  {Object} expression Expression parts
	 * @return {String}            Parsed expression
	 */
	parseExpression = function( expression ) {
		return expression.aggregation.replace("$1", expression.isDimension ? expression.field : qUtil.escapeField(expression.field))
	},

	/**
	 * Return a new definition of a hypercube dimension
	 *
	 * @param  {String|Object} dimension Dimension expression or details
	 * @param  {String}        label     Optional. Label expression
	 * @return {Object}                  Dimension definition
	 */
	createHyperCubeDefDimension = function( dimension, label ) {
		var isDimension = "string" !== typeof dimension,
		    expression = isDimension ? parseExpression(dimension) : dimension;

		return {
			isField: ! isDimension,
			isDimension: !! isDimension,
			dimension: dimension,
			qDef: {
				cId: qUtil.generateId(),
				qFieldDefs: [isDimension ? "=".concat(expression) : expression],
				qFieldLabels: [label || expression],
				autoSort: true,
				qSortCriterias: [{
					qSortByAscii: 1
				}]
			}
		};
	},

	/**
	 * Return a new definition of a hypercube measure
	 *
	 * @param  {Object|String} measure Measure details or expression
	 * @param  {String}        label   Optional. Label expression
	 * @return {Object}                Measure definition
	 */
	createHyperCubeDefMeasure = function( measure, label ) {
		var isExpression = "string" === typeof measure,
		    expression = isExpression ? measure : parseExpression(measure);

		return {
			measure: measure,
			qDef: {
				cId: qUtil.generateId(),
				qDef: expression,
				qLabel: label || expression
			},
			qSortBy: {
				qSortByNumeric: -1
			}
		};
	},

	/**
	 * Reset the visualization's hypercube definition
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise}          Properties are saved
	 */
	prepareInspectorTableVisualization = function( $scope, tableData ) {
		var dfd = $q.defer(), newProps = util.copy(initProps), loadNewTable;

		// Reset table name and dimensions
		newProps.props.tableName = tableData.value;
		newProps.qHyperCubeDef.qDimensions = [];
		newProps.qHyperCubeDef.qMeasures = [];

		// Reset existing properties
		if ($scope.tableInspectorId) {

			// Remove stored manipulations
			newProps.props.removedFields = [];
			newProps.props.addedMeasures = [];

			// Reloading the table
			loadNewTable = true;

			dfd.resolve();

		// Setup new properties
		} else {

			// Set the stored manipulations. Maybe stored values are present
			newProps.props.removedFields = $scope.layout.props.removedFields || [];
			newProps.props.addedMeasures = $scope.layout.props.addedMeasures || [];

			// Loading a new or previous table
			loadNewTable = $scope.layout.props.tableName !== tableData.value;

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
			var tableDimensions = loadNewTable ? tableData.qData.qFields.map(a => a.qName) : ($scope.layout.props.tableDimensions || []).concat(newProps.props.removedFields),
			    actualRemovedFields = [], actualAddedMeasures = [];

			// Walk table dimensions
			tableDimensions.forEach( function( a ) {
				if ("string" === typeof a) {

					// Skip removed fields
					if (-1 !== newProps.props.removedFields.indexOf(a)) {
						actualRemovedFields.push(a);
						return;
					}

				// Skip dimensions for non-existing fields
				} else if (-1 === tableData.qData.qFields.map(b => b.qName).indexOf(a.field)) {
					return;
				}

				// Add dimension to hypercube
				newProps.qHyperCubeDef.qDimensions.push(createHyperCubeDefDimension(a));
			});

			// Walk added measures
			newProps.props.addedMeasures.forEach( function( a ) {

				// Skip measures for non-existing fields
				if (-1 === tableData.qData.qFields.map(b => b.qName).indexOf(a.field)) {
					return;
				}

				// Collect added measure
				actualAddedMeasures.push(a);

				// Add measure to hypercube
				newProps.qHyperCubeDef.qMeasures.push(createHyperCubeDefMeasure(a));
			});

			// Correct the stored manipulations
			newProps.props.removedFields = $scope.removedFields = actualRemovedFields;
			newProps.props.addedMeasures = $scope.addedMeasures = actualAddedMeasures;

			// Add columns to ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				var listDiff = newProps.qHyperCubeDef.qDimensions.length + newProps.qHyperCubeDef.qMeasures.length - newProps.qHyperCubeDef[a].length;

				newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].length
					// Use previously defined ordering and sorting lists
					? (0 < listDiff)

						// The new list is longer
						? newProps.qHyperCubeDef[a].concat(
							_.keys(newProps.qHyperCubeDef.qDimensions.concat(newProps.qHyperCubeDef.qMeasures)).map(Number).slice(newProps.qHyperCubeDef[a].length)
						)

						// The new list is shorter
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
	 * Create a new inspector table object
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Promise}       Table is created
	 */
	createInspectorTableVisualization = function( $scope, props ) {
		var newProps = getInspectorTablePropsFromObjProps(props);

		// Create viz-on-the-fly with selected patches
		return app.visualization.create("table", [], newProps).then( function( object ) {

			// Store visualization id for future reference
			$scope.tableInspectorId = object.id;

			// Insert object in the extension's element
			return object.show($scope.containerId, {
				/**
				 * Act when the table is rendered
				 *
				 * This callback is triggered on initial render and further visualization
				 * updates like selections and column ordering and sorting.
				 *
				 * The following logic enables auto-updates on removal or adding of fields
				 * in the app's datamodel.
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
						if (! fieldNames.length) {
							resetExtensionVisualization($scope);

						// Structure was changed, so reload the inspector table
						} else if (hasNewStructure) {
							reloadInspectorTableVisualization($scope);
						}
					});

					// Synchronize table properties to the extension
					getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {

						// Store the current column order and sort order
						// On manual column ordering dimensions and fields are just reordered in the
						// qHyperCubeDef.qDimensions list, so save their locations separately in a list
						// of table dimensions. A similar thing happens for measures where both the
						// column order and the order of measures in the qHyperCubeDef.qMeasures list
						// is reset.
						updateExtensionVisualization($scope, {
							props: {
								tableDimensions: props.qHyperCubeDef.qDimensions.map(a => a.dimension),
								addedMeasures: props.qHyperCubeDef.qMeasures.map(a => a.measure)
							},
							qHyperCubeDef: {
								qColumnOrder: props.qHyperCubeDef.qColumnOrder,
								qInterColumnSortOrder: props.qHyperCubeDef.qInterColumnSortOrder
							}
						});
					});

					// Update the custom footnote
					setCustomFootnote($scope);
				},

				// When disabling interaction
				noInteraction: $scope.options && $scope.options.noInteraction,

				// When disabling selections
				noSelections: $scope.options && $scope.options.noSelections
			});
		});
	},

	/**
	 * Update the inspector table object
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} props  Propeprties with updates
	 * @return {Promise}       Table is updated
	 */
	updateInspectorTableVisualization = function( $scope, props ) {
		var dfd = $q.defer(), patcher = getPatcher("inspectorTable"), patches;

		// Get the table's object model
		return app.getObject($scope.tableInspectorId).then( function( model ) {

			// Remove soft patches just before updating
			model.clearSoftPatches();

			// Define patches from props
			patches = patcher(getInspectorTablePropsFromObjProps(props));

			// Apply patches
			return model.applyPatches(patches);
		}).catch(console.error);
	},

	/**
	 * Shorthand for updating both the data table and the extension
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} props  Properties with updates
	 * @return {Promise}       Table is updated
	 */
	updateInspectorTableVisualizationAndExtension = function( $scope, props ) {
		return updateInspectorTableVisualization($scope, props).then( function() {
			return updateExtensionVisualization($scope, props);
		});
	},

	/**
	 * Reload the inspector table object
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Promise}       Table is reloaded
	 */
	reloadInspectorTableVisualization = function( $scope ) {
		return getAppTableByName($scope.layout.props.tableName).then( function( tableData ) {
			return $scope.fsm.select(tableData);
		});
	},

	/**
	 * Convert the extension to a straight table based on the inspector table
	 *
	 * The inspector table's object is not removed in order to
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
	 * @return {Promise}       Extension is converted
	 */
	convertExtensionToStraightTableVisualization = function( $scope ) {
		var dfd = $q.defer();

		// Require the inspector table first when a data table is selected
		if (! $scope.tableInspectorId && $scope.selectedTableData) {
			$scope.fsm.select().then(dfd.resolve);
		} else {
			dfd.resolve();
		}

		// Get the inspector table's properties
		return dfd.promise.then(() => getEffectivePropertiesById($scope.tableInspectorId)).then( function( props ) {

			// Populate dimension column id values
			props.qHyperCubeDef.qDimensions = props.qHyperCubeDef.qDimensions;

			// Populate measure column id values
			props.qHyperCubeDef.qMeasures = props.qHyperCubeDef.qMeasures;

			// Reset metadata
			props.qHyperCubeDef.qCalcCondition = {};
			props.showTitles = true;
			props.title = "";
			props.subtitle = "";

			// Updating the extension's object
			props.qInfo.qId = $scope.object.model.id;

			// Fully overwrite the extension's properties
			return $scope.object.model.setProperties(props);
		}).catch(console.error);
	},

	/**
	 * Add a field to the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {String} fieldName Field name
	 * @param  {Number} position  Optional. Position to insert the field at.
	 * @return {Promise}          Field is added
	 */
	addTableField = function( $scope, tableData, fieldName, position ) {

		// Remove the field from the table's hidden fields list
		$scope.removedFields = _.difference($scope.removedFields, [fieldName]);

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					removedFields: $scope.removedFields
				}
			};

			// Add field to the dimension list
			newProps.qHyperCubeDef.qDimensions.push(createHyperCubeDefDimension(fieldName));

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
			return updateInspectorTableVisualizationAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Add all removed fields to the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Number} position  Optional. Position to insert the field at.
	 * @return {Promise}          Fields are added
	 */
	addAllTableFields = function( $scope, tableData, position ) {

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					removedFields: []
				}
			};

			// Walk the removed fields
			$scope.removedFields.forEach( function( a, num ) {

				// Add field to the dimension list
				newProps.qHyperCubeDef.qDimensions.push(createHyperCubeDefDimension(a));

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
			return updateInspectorTableVisualizationAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Remove a field from the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {String} fieldName Field name
	 * @return {Promise}          Field is hidden
	 */
	removeTableField = function( $scope, tableData, fieldName ) {

		// Add the field to the table's hidden fields list
		$scope.removedFields = _.uniq($scope.removedFields.concat([fieldName]));

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					removedFields: $scope.removedFields
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
				return updateInspectorTableVisualizationAndExtension($scope, newProps);
			}
		}).catch(console.error);
	},

	/**
	 * Remove all fields from the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise}          Fields are removed
	 */
	removeAllTableFields = function( $scope, tableData ) {

		// Add all fields to the table's hidden fields list
		$scope.removedFields = tableData.qData.qFields.map(a => a.qName);

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					removedFields: $scope.removedFields
				}
			},

			// Get field count
			fieldCount = $scope.removedFields.length,

			// Get dimension count
			dimensionCount = props.qHyperCubeDef.qDimensions.filter(a => a.isDimension).length;

			// Clear fields in hypercube
			newProps.qHyperCubeDef.qDimensions = props.qHyperCubeDef.qDimensions.filter(a => a.isDimension);

			// Remove the fields from ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
					return b < dimensionCount || b > fieldCount + dimensionCount - 1;
				}).map( function( b ) {
					return b < dimensionCount ? b : b - fieldCount;
				});
			});

			// Update props on the table and extension
			return updateInspectorTableVisualizationAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Remove all columns but the indicated field from the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {String} fieldName Field name
	 * @param  {Number} position  Optional. Required when removing with direction
	 * @param  {Number} direction Optional. Removal direction, -1 for left, 1 for right
	 * @return {Promise}          Fields are hidden
	 */
	removeOtherTableColumns = function( $scope, tableData, fieldName, position, direction ) {
		direction = direction || 0;

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var ix, fieldIndicesToRemove, qDimensions, qMeasures, newProps;

			// Remove with direction
			if (direction) {

				// Find field in hypercube
				ix = props.qHyperCubeDef.qColumnOrder.find(( a, ix ) => ix === position);

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
					return a.isField && -1 !== fieldIndicesToRemove.indexOf(ix);
				}).map(a => a.qDef.qFieldDefs[0])));

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
				fieldIndicesToRemove = props.qHyperCubeDef.qDimensions.map((a, ix) => ix).filter(a => a !== ix).concat(props.qHyperCubeDef.qMeasures.map( function( a, ix ) {
					return props.qHyperCubeDef.qDimensions.length + ix;
				}));

				// Keep the field from the dimension list
				qDimensions = props.qHyperCubeDef.qDimensions.splice(ix, 1);

				// Remove all measures
				qMeasures = [];

				// Add all other fields to the table's hidden fields list
				$scope.removedFields = tableData.qData.qFields.filter(a => a.qName !== fieldName).map(a => a.qName);

				// Remove other manipulations
				$scope.addedMeasures = [];
			}

			// Define new table properties
			newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
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
				return updateInspectorTableVisualizationAndExtension($scope, newProps);
			}
		}).catch(console.error);
	},

	/**
	 * Add a dimension to the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Object} dimension Dimension details
	 * @param  {Number} position  Optional. Position to insert the dimension at.
	 * @return {Promise}          Dimension is added
	 */
	addTableDimension = function( $scope, tableData, dimension, position ) {

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef
			}, ix;

			// Add dimension to the dimensions list
			newProps.qHyperCubeDef.qDimensions.push(createHyperCubeDefDimension(dimension));

			// Find dimension in hypercube
			ix = newProps.qHyperCubeDef.qDimensions.length - 1;

			// Add the dimension to ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {

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
			return updateInspectorTableVisualizationAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Remove a dimension from the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Number} position  Position at which to remove the dimension
	 * @return {Promise}          Dimension is removed
	 */
	removeTableDimension = function( $scope, tableData, position ) {

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef
			},

			// Find dimension in columns
			colNum = newProps.qHyperCubeDef.qColumnOrder.length > position ? newProps.qHyperCubeDef.qColumnOrder[position] : -1,

			// Find dimension in hypercube
			ix = colNum;

			// Dimension is found
			if (-1 !== ix) {

				// Remove the dimension from the dimension list
				newProps.qHyperCubeDef.qDimensions.splice(colNum, 1);

				// Remove the field from ordering and sorting lists
				["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
						return b !== colNum;
					}).map( function( b ) {
						return b < colNum ? b : b - 1;
					});
				});

				// Update props on the table and extension
				return updateInspectorTableVisualizationAndExtension($scope, newProps);
			}
		}).catch(console.error);
	},

	/**
	 * Remove all dimensions from the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise}          Dimensions are removed
	 */
	removeAllTableDimensions = function( $scope, tableData ) {

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef
			},

			// Get field count
			fieldCount = props.qHyperCubeDef.qDimensions.filter(a => a.isField).length,

			// Get dimension count
			dimensionCount = props.qHyperCubeDef.qDimensions.filter(a => a.isDimension).length;

			// Clear dimensions in hypercube
			newProps.qHyperCubeDef.qDimensions = props.qHyperCubeDef.qDimensions.filter(a => a.isField);

			// Remove the dimensions from ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
					return b < fieldCount || b > fieldCount + dimensionCount - 1;
				}).map( function( b ) {
					return b < fieldCount ? b : b - dimensionCount;
				});
			});

			// Update props on the table and extension
			return updateInspectorTableVisualizationAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Add a measure to the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Object} measure   Measure details
	 * @param  {Number} position  Optional. Position to insert the measure at.
	 * @return {Promise}          Measure is added
	 */
	addTableMeasure = function( $scope, tableData, measure, position ) {

		// Add the measure to the table's added measures list
		$scope.addedMeasures = $scope.addedMeasures.concat([measure]);

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					addedMeasures: $scope.addedMeasures
				}
			}, ix;

			// Add measure to the measures list
			newProps.qHyperCubeDef.qMeasures.push(createHyperCubeDefMeasure(measure));

			// Find measure in hypercube
			ix = newProps.qHyperCubeDef.qDimensions.length + newProps.qHyperCubeDef.qMeasures.length - 1;

			// Add the measure to ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {

				// Add field at position
				if ("undefined" === typeof position) {
					newProps.qHyperCubeDef[a].push(ix);
				} else {
					newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].slice(0, position + 1).concat(ix, newProps.qHyperCubeDef[a].slice(position + 1));
				}
			});

			// Update props on the table and extension
			return updateInspectorTableVisualizationAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Remove a measure from the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @param  {Number} position  Position at which to remove the measure
	 * @return {Promise}          Measure is removed
	 */
	removeTableMeasure = function( $scope, tableData, position ) {

		// Removing one is equal to removing all
		if (1 === $scope.addedMeasures.length) {
			return removeAllTableMeasures($scope, tableData);
		}

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {}
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
				return updateInspectorTableVisualizationAndExtension($scope, newProps);
			}
		}).catch(console.error);
	},

	/**
	 * Remove all measures from the inspector table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise}          Measures are removed
	 */
	removeAllTableMeasures = function( $scope, tableData ) {

		// Clear the table's added measures list
		$scope.addedMeasures = [];

		// Get the inspector table's properties
		return getEffectivePropertiesById($scope.tableInspectorId).then( function( props ) {
			var newProps = {
				qHyperCubeDef: props.qHyperCubeDef,
				props: {
					addedMeasures: []
				}
			},

			// Get dimension count
			dimensionCount = props.qHyperCubeDef.qDimensions.length;

			// Clear measures in hypercube
			newProps.qHyperCubeDef.qMeasures = [];

			// Remove the measures from ordering and sorting lists
			["qColumnOrder", "qInterColumnSortOrder"].forEach( function( a ) {
				newProps.qHyperCubeDef[a] = newProps.qHyperCubeDef[a].filter( function( b ) {
					return b < dimensionCount;
				});
			});

			// Update props on the table and extension
			return updateInspectorTableVisualizationAndExtension($scope, newProps);
		}).catch(console.error);
	},

	/**
	 * Return the properties of the table profile visualization
	 *
	 * @param  {Object} tableData Table data
	 * @return {Promise}          Visualization properties
	 */
	getTableProfileProps = function( tableData ) {
		/**
		 * Holds the property definition of the table profile visualization
		 *
		 * @type {Object}
		 */
		var props = {
			qHyperCubeDef: {
				qDimensions: [],
				qMeasures: [],
				qColumnOrder: [0]
			},
			showTitles: true,
			title: "Table Profile - ".concat(tableData.value),
			totals: { show: false },
			multiline: {
				wrapTextInHeaders: false,
				wrapTextInCells: false
			},
		},

		/**
		 * Holds the details for the profile columns
		 *
		 * @type {Object}
		 */
		columns = {
			uniqueValues: { label: "Unique values", list: [] },
			uniqueness: { label: "Uniqueness", list: [] },
			subsetRatio: { label: translator.get("DataModelViewer.Footer.Metadata.SubsetRatio"), list: [] },
			nullCount: { label: translator.get("QCS.Common.DataProfile.prop_nullValueCount"), list: [] },
			density: { label: translator.get("DataModelViewer.Footer.Metadata.Density"), list: [] },
			textCount: { label: translator.get("QCS.Common.DataProfile.prop_textValueCount"), list: [] },
			numericCount: { label: translator.get("QCS.Common.DataProfile.prop_numericValueCount"), list: [] },
			emptyCount: { label: translator.get("QCS.Common.DataProfile.prop_emptyStringCount"), list: [] },
			positiveCount: { label: translator.get("QCS.Common.DataProfile.prop_positiveValueCount"), list: [] },
			negativeCount: { label: translator.get("QCS.Common.DataProfile.prop_negativeValueCount"), list: [] },
			zeroCount: { label: translator.get("QCS.Common.DataProfile.prop_zeroValueCount"), list: [] },
			size: { label: "Size", list: [] },
			avgBytes: { label: "Avg bytes", list: [] },
			tags: { label: translator.get("QCS.Common.DataProfile.prop_tags"), list: [], isText: true },
			format: { label: "Format", list: [], isText: true },
			comment: { label: translator.get("DataModelViewer.Footer.Metadata.Comment"), list: [], isText: true },
		};

		return app.model.engineApp.getTableProfileData(tableData.value).then( function( tableProfile ) {
			var fields = [], valueList, i, def, ix;

			// Walk all table fields
			tableData.qData.qFields.forEach( function( tField ) {
				var pField = tableProfile.qProfiling.qFieldProfiling.find(a => a.qName === tField.qName);

				// Add field
				fields.push(pField.qName);

				// Populate metadata fields
				columns.uniqueValues.list.push({field: pField.qName, value: "'".concat(Number(pField.qDistinctValues).toLocaleString(), "'") });
				columns.uniqueness.list.push({field: pField.qName, value: "'".concat(Number(Math.round((pField.qDistinctValues / tField.qnRows * 100) * 100) / 100).toLocaleString(), "%'") });
				columns.subsetRatio.list.push({field: pField.qName, value: "'".concat(Number(Math.round((tField.qSubsetRatio * 100) * 100) / 100).toLocaleString(), "%'") });
				columns.nullCount.list.push({field: pField.qName, value: "'".concat(Number(pField.qNullValues).toLocaleString(), "'") });
				columns.density.list.push({field: pField.qName, value: "'".concat(Number(Math.round(((tField.qnRows - pField.qNullValues) / tField.qnRows * 100) * 100) / 100).toLocaleString(), "%'") });
				columns.textCount.list.push({field: pField.qName, value: "'".concat(Number(pField.qTextValues).toLocaleString(), "'") });
				columns.numericCount.list.push({field: pField.qName, value: "'".concat(Number(pField.qNumericValues).toLocaleString(), "'") });
				columns.emptyCount.list.push({field: pField.qName, value: "'".concat(Number(pField.qEmptyStrings).toLocaleString(), "'") });
				columns.positiveCount.list.push({field: pField.qName, value: "'".concat(Number(pField.qPosValues).toLocaleString(), "'") });
				columns.negativeCount.list.push({field: pField.qName, value: "'".concat(Number(pField.qNegValues).toLocaleString(), "'") });
				columns.zeroCount.list.push({field: pField.qName, value: "'".concat(Number(pField.qZeroValues).toLocaleString(), "'") });
				// columns.size.list.push({field: pField.qName, value: "'?'" });
				// columns.avgBytes.list.push({field: pField.qName, value: "'?'" });
				columns.tags.list.push({field: pField.qName, value: "'".concat(pField.qFieldTags.join(", "), "'") });
				// columns.format.list.push({field: pField.qName, value: "'?'" });
				columns.comment.list.push({field: pField.qName, value: "'".concat(tField.qComment || "", "'") });
			});

			// Create the value list
			matchList = "Match($Field,'".concat(fields.join("','"), "')");

			// Start first hypercube field
			props.qHyperCubeDef.qDimensions.push(createHyperCubeDefDimension("=$Field", translator.get("Common.Field")));

			// Walk all metadata fields
			for (i in columns) {
				if (columns.hasOwnProperty(i) && columns[i].list.length) {

					// Process text column as dimension
					if (columns[i].isText) {
						def = createHyperCubeDefDimension(
							"=Pick(".concat(matchList, ",", columns[i].list.map(a => a.value).join(", "), ")"),
							columns[i].label
						);

						// Add profile hypercube field
						ix = props.qHyperCubeDef.qDimensions.push(def) - 1;

						// Define field order. Move all measures 1 place up
						props.qHyperCubeDef.qColumnOrder = props.qHyperCubeDef.qColumnOrder.map(a => a >= ix ? a + 1 : a);
						props.qHyperCubeDef.qColumnOrder.push(ix);

					// Create measure
					} else {
						def = createHyperCubeDefMeasure(
							"Only({<$Table={'".concat(tableData.value, "'}>} Pick(", matchList, ",", columns[i].list.map(a => a.value).join(", "), "))"),
							columns[i].label
						);

						// Add profile hypercube field
						ix = props.qHyperCubeDef.qMeasures.push(def) - 1;

						// Define field order
						props.qHyperCubeDef.qColumnOrder.push(props.qHyperCubeDef.qDimensions.length + ix);
					}
				}
			}

			return props;
		});
	},

	/**
	 * Create the profile table
	 *
	 * @param  {Object} $scope    Extension scope
	 * @param  {Object} tableData Table data
	 * @return {Promise}          Profile table is created
	 */
	createTableProfileVisualization = function( $scope, tableData ) {
		return getTableProfileProps(tableData).catch(console.error).then( function( newProps ) {

			// Create viz-on-the-fly with profile data
			return app.visualization.create("table", [], newProps).then( function( object ) {

				// Store visualization id for future reference
				$scope.tableProfileId = object.id;

				// Insert object in the extension's element
				return object.show($scope.containerId, {
					onRendered: function() {

						// Update the custom footnote
						setCustomFootnote($scope);
					},

					// Disable selections
					noSelections: true
				});
			});
		});
	},

	/**
	 * Update the custom footnote
	 *
	 * @param  {Object} $scope Extension scope
	 * @return {Void}
	 */
	setCustomFootnote = function( $scope ) {

		// Table inspector visualization
		if ($scope.tableInspectorId) {
			var notes = [];

			// Get the inspector table's object model
			app.getObject($scope.tableInspectorId).then( function( model ) {
				var noOfTableCols = $scope.selectedTableData.qData.qFields.length,
				    noOfTableRows = Math.max.apply(null, $scope.selectedTableData.qData.qFields.map(a => a.qnRows).filter(Boolean)),
				    noOfCols = model.layout.qHyperCube.qSize.qcx,
				    noOfRows = model.layout.qHyperCube.qSize.qcy;

				// Full table size
				notes.push("Full: ".concat(Number(noOfTableCols).toLocaleString(), " × ", Number(noOfTableRows).toLocaleString()));

				// Visible size
				if (! (noOfTableCols === noOfCols && noOfTableRows === noOfRows)) {
					notes.push("Visible: ".concat(Number(noOfCols).toLocaleString(), " × ", Number(noOfRows).toLocaleString()));
				}
			}).then( function() {
				$scope.footnotes = notes;
			});

		// Table profile visualization
		} else if ($scope.tableProfileId) {
			var noOfTableCols = $scope.selectedTableData.qData.qFields.length,
			    noOfTableRows = Math.max.apply(null, $scope.selectedTableData.qData.qFields.map(a => a.qnRows).filter(Boolean));

			// Full table size
			$scope.footnotes = ["Full: ".concat(Number(noOfTableCols).toLocaleString(), " × ", Number(noOfTableRows).toLocaleString())];

		} else {
			$scope.footnotes = [];
		}
	},

	/**
	 * Extension controller function
	 *
	 * @param  {Object} $scope Extension scope
	 * @param  {Object} $el    Extension's jQuery element
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
				$scope.fsm.select(item);
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
				from: "IDLE", to: "TABLE", name: "SELECT"
			}, {
				from: "TABLE", to: "TABLE", name: "SELECT"
			}, {
				from: "TABLE", to: "IDLE", name: "CLOSE"
			}, {
				from: "TABLE", to: "PROFILE", name: "VIEW_PROFILE"
			}, {
				from: "PROFILE", to: "PROFILE", name: "VIEW_PROFILE"
			}, {
				from: "PROFILE", to: "TABLE", name: "SELECT"
			}, {
				from: "PROFILE", to: "IDLE", name: "CLOSE"
			}],
			on: {
				beforeSelect: function( lifecycle, tableData ) {
					$scope.loading = true;

					// Reset custom footnotes
					$scope.footnotes = [];

					// Keep table data
					if (tableData) {
						$scope.selectedTableData = tableData;
					}
				},
				enterTable: function() {

					// When (re)loading, clear any stored manipulations
					$scope.removedFields = [];
					$scope.addedMeasures = [];

					// Setup table visualization
					return selectTable($scope, $scope.selectedTableData);
				},
				afterSelect: function() {
					$scope.loading = false;
				},
				leaveTable: function( lifecycle ) {

					// Reset custom footnotes
					$scope.footnotes = [];

					// Bail when loading a new table
					if ("SELECT" === lifecycle.name) {
						return;
					}

					// Get the inspector table
					return app.getObject($scope.tableInspectorId).then( function( model ) {

						// Break engine connection and destroy scope
						model.close();

						// Clear inner html
						$("#".concat($scope.containerId)).empty();

						// Detach id from scope
						$scope.tableInspectorId = undefined;
					});
				},
				afterClose: function() {

					// Remove table data
					$scope.selectedTableData = false;
				},
				beforeViewProfile: function() {
					$scope.loading = true;
				},
				afterViewProfile: function() {
					$scope.loading = false;
				},
				enterProfile: function() {

					// Setup profile visualization
					return createTableProfileVisualization($scope, $scope.selectedTableData);
				},
				leaveProfile: function() {

					// Reset custom footnotes
					$scope.footnotes = [];

					// Get the inspector table
					return app.getObject($scope.tableProfileId).then( function( model ) {

						// Break engine connection and destroy scope
						model.close();

						// Clear inner html
						$("#".concat($scope.containerId)).empty();

						// Detach id from scope
						$scope.tableProfileId = undefined;
					});
				}
			}
		});

		// Container id
		$scope.containerId = "qs-emergo-table-inspector-".concat($scope.$id);

		// The selected table data
		$scope.selectedTableData = false;

		// Removed fields
		$scope.removedFields = $scope.layout.props.removedFields || [];

		// Added measures
		$scope.addedMeasures = $scope.layout.props.addedMeasures || [];

		// Custom footnote
		$scope.footnotes = [];

		// Custom styles
		$scope.styles = {};

		// Watch changes in the active theme
		$scope.$watch( function() {
			return currTheme;
		}, function() {
			var getThemeStyle = themeStyleGetter("object.straightTable");

			// Define theme custom styles
			$scope.styles = {
				footer: {
					"font-size": getFontSizeInEm(getThemeStyle("title.footer", "fontSize")),
					"font-family": getThemeStyle("title.footer", "fontFamily"),
					color: getThemeStyle("title.footer", "color"),
					"background-color": getThemeStyle("title.footer", "backgroundColor")
				},
				footerActionButton: {
					"font-family": getThemeStyle("title.footer", "fontFamily"),
					color: getThemeStyle("title.footer", "color")
				}
			};
		});

		// Initiate first data table when set
		getAppTableByName($scope.layout.props.tableName).then( function( tableData ) {

			// Select the table when found
			if (tableData) {
				$scope.fsm.select(tableData);
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
		 * Toggle the table view
		 *
		 * @return {Void}
		 */
		$scope.toggleTableView = function() {
			if (! $scope.object.inEditState()) {

				// View table profile
				if ($scope.tableInspectorId) {
					$scope.fsm.viewProfile();

				// View table inspector
				} else if ($scope.tableProfileId) {
					$scope.fsm.select();
				}
			}
		};

		/**
		 * Return whether the extension can be converted
		 *
		 * @return {Boolean} Can convert the extension
		 */
		$scope.canConvertToTable = function() {
			return !! $scope.tableInspectorId;
		};

		/**
		 * Convert extension to table
		 *
		 * @return {Void}
		 */
		$scope.convertToTable = function() {
			if ($scope.canConvertToTable()) {
				convertExtensionToStraightTableVisualization($scope);
			}
		};

		/**
		 * Button select handler
		 *
		 * @return {Void}
		 */
		$scope.open = function() {
			if (! $scope.object.inEditState() && ! ($scope.options && $scope.options.noInteraction) && ! $scope.selectedTableData) {
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
	 * @return {Object}          The cell's scope
	 */
	getTableCellScope = function( element ) {
		var cellClasses = ".qv-st-data-cell, .qv-st-header-cell",
		    $element = $(element);

		return $element.is(cellClasses) ? $element.scope() : $element.parents(cellClasses).scope();
	},

	/**
	 * Holds the list of available dimensions
	 *
	 * @type {Array}
	 */
	dimensionList = {
		formattingFunctions: {
			label: "Formatting functions",
			options: [
				"Date($1)",
				"Interval($1)",
				"Money($1)",
				"Num($1)",
				"Time($1)",
				"Timestamp($1)"
			]
		},
		generalNumericFunctions: {
			label: "General numeric functions",
			options: [
				"BitCount($1)",
				"Ceil($1)",
				"Even($1)",
				"Fabs($1)",
				"Fact($1)",
				"Floor($1)",
				"Frac($1)",
				"Odd($1)",
				"Round($1)",
				"Sign($1)"
			]
		},
		logicalFunctions: {
			label: "Logical functions",
			options: [
				"IsNum($1)",
				"IsText($1)"
			]
		},
		nullFunctions: {
			label: "NULL functions",
			options: [
				"EmptyIsNull($1)",
				"IsNull($1)"
			]
		},
		stringFunctions: {
			label: "String functions",
			options: [
				"Capitalize($1)",
				"Chr($1)",
				"Evaluate($1)",
				"Len($1)",
				"Lower($1)",
				"LTrim($1)",
				"Ord($1)",
				"RTrim($1)",
				"Trim($1)",
				"Upper($1)"
			]
		}
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
					$scope.fsm.select(a);
				}
			});
		},

		/**
		 * Return whether the column is a field definition
		 *
		 * @param  {Object} column Column data
		 * @return {Boolean}       Column is a field
		 */
		isField = function( column ) {
			return -1 !== $scope.layout.props.tableDimensions.filter(a => ! a.field).indexOf(column.text || column);
		},

		/**
		 * Return whether the column is a dimension definition
		 *
		 * @param  {Object} column Column data
		 * @return {Boolean}       Column is a dimension
		 */
		isDimension = function( column ) {
			return -1 !== $scope.layout.props.tableDimensions.filter(a => a.field).map(a => parseExpression(a)).indexOf(column.text || column);
		},

		/**
		 * Add a new dimension menu item to the provided menu
		 *
		 * @param  {Object}  menu        Menu to add to
		 * @param  {Object}  table       Table context
		 * @param  {Object}  fieldName   Field name
		 * @param  {Object}  colIndex    Optional. Column index
		 * @param  {Boolean} isDimension Optional. Whether this field is a dimension.
		 * @return {Void}
		 */
		addDimensionMenuItems = function( menu, table, fieldName, colIndex, isDimension ) {
			var i, j, mmenu;

			isDimension = !! isDimension;

			for (i in dimensionList) {
				if (dimensionList.hasOwnProperty(i)) {

					// Add aggregation type menu
					mmenu = menu.addItem({
						label: dimensionList[i].label,
						tid: i
					});

					// Add aggregation options
					dimensionList[i].options.forEach( function( aggregation, ix ) {
						mmenu.addItem({
							label: parseExpression({ aggregation, field: fieldName, isDimension }),
							tid: "add-dimension-".concat(i.toLowerCase(), "-", ix),
							select: function() {
								addTableDimension($scope, table, {
									aggregation: aggregation,
									field: fieldName,
									isDimension: isDimension
								}, colIndex);
							}
						});
					});
				}
			}
		},

		/**
		 * Add a new measure menu item to the provided menu
		 *
		 * @param  {Object}  menu        Menu to add to
		 * @param  {Object}  table       Table context
		 * @param  {Object}  fieldName   Field name
		 * @param  {Object}  colIndex    Optional. Column index
		 * @param  {Boolean} isDimension Optional. Whether this field is a dimension.
		 * @return {Void}
		 */
		addMeasureMenuItems = function( menu, table, fieldName, colIndex, isDimension ) {
			var i, j, mmenu;

			isDimension = !! isDimension;

			// Add quick measures
			quickMeasureList.forEach( function( aggregation, ix ) {
				menu.addItem({
					label: parseExpression({ aggregation, field: fieldName, isDimension }),
					tid: "add-measure-quick-".concat(ix),
					select: function() {
						addTableMeasure($scope, table, {
							aggregation: aggregation,
							field: fieldName,
							isDimension: isDimension
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
							label: parseExpression({ aggregation, field: fieldName, isDimension }),
							tid: "add-measure-".concat(i.toLowerCase(), "-", ix),
							select: function() {
								addTableMeasure($scope, table, {
									aggregation: aggregation,
									field: fieldName,
									isDimension: isDimension
								}, colIndex);
							}
						});
					});
				}
			}
		};

		// Bail when no scope is available
		if (! $scope) {
			return;
		}

		// When we're in Edit mode
		if (object.inEditState()) {

			// When the inspector table is active
			if ($scope.tableInspectorId) {

				// Convert to table
				menu.addItem({
					translation: ["contextMenu.convertTo", "Table"],
					tid: "convert-to-table",
					icon: "lui-icon lui-icon--table",
					select: function() {
						convertExtensionToStraightTableVisualization($scope);
					}
				});
			}

			// Bail when done
			return;
		}

		// Query tables, then add menu items
		getAppTables().then( function( tables ) {

			/**
			 * Holds the cell's scope
			 *
			 * @type {Object}
			 */
			var $cellScope = getTableCellScope($event.target) || {},

			/**
			 * Holds the cell's cell data
			 *
			 * @type {Object}
			 */
			cell = $cellScope.cell || $cellScope.header || {};

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

			// When the inspector table is active
			if ($scope.tableInspectorId) {

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
				 * Holds the Add dimension menu
				 *
				 * @type {Object}
				 */
				addDimensionMenu,

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
				 * Holds the number of fields
				 *
				 * @type {Array}
				 */
				numFields = object.layout.props.tableDimensions.filter(a => ! a.field).length,

				/**
				 * Holds the number of dimensions
				 *
				 * @type {Array}
				 */
				numDimensions = object.layout.props.tableDimensions.filter(a => a.field).length,

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
				}) || {} : {},

				/**
				 * Holds whether the column is a field
				 *
				 * @type {Boolean}
				 */
				columnIsField = column.isDimension && ! isDimension(column),

				/**
				 * Holds the maximum column index
				 *
				 * @type {Number}
				 */
				maxColIx = columns.reduce( function( max, a ) {
					return a.colIx > max ? a.colIx : max;
				}, 0);

				// View table profile
				menu.addItem({
					label: "View table profile",
					tid: "view-table-profile",
					icon: "lui-icon lui-icon--search",
					select: function() {
						$scope.fsm.viewProfile();
					}
				});

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
								reloadInspectorTableVisualization($scope);
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

				// Remove all other fields
				if (columnIsField) {
					removeColumnMenuItems.push({
						label: "Remove all columns but '".concat(column.text, "'"),
						tid: "remove-other-fields",
						select: function() {
							removeOtherTableColumns($scope, selectedTable, column.text);
						}
					});
				}

				// Remove left columns
				if (cell.colIx > 0) {
					removeColumnMenuItems.push({
						label: "Remove all columns to the left",
						tid: "remove-left-columns",
						select: function() {
							removeOtherTableColumns($scope, selectedTable, column.text, cell.colIx, -1);
						}
					});
				}

				// Remove right columns
				if (cell.colIx < maxColIx) {
					removeColumnMenuItems.push({
						label: "Remove all columns to the right",
						tid: "remove-right-columns",
						select: function() {
							removeOtherTableColumns($scope, selectedTable, column.text, cell.colIx, 1);
						}
					});
				}

				// Remove all fields
				if (numFields && ! (isField(column) && 1 === numFields)) {
					removeColumnMenuItems.push({
						label: "Remove all fields",
						tid: "remove-all-fields",
						select: function() {
							removeAllTableFields($scope, selectedTable);
						}
					});
				}

				// Add dimension
				addDimensionMenu = menu.addItem({
					label: "Add dimension",
					tid: "add-dimension",
					icon: "lui-icon lui-icon--add"
				});

				// Add single field or dimension dimensions
				if (column.isDimension) {
					addDimensionMenuItems(addDimensionMenu, selectedTable, column.text, cell.colIx, isDimension(column));

				// Add all field dimensions
				} else {
					selectedTable.qData.qFields.forEach( function( a ) {
						var addDimensionFieldMenu = addDimensionMenu.addItem({
							label: a.qName,
							tid: "add-dimension-".concat(a.qName)
						});

						addDimensionMenuItems(addDimensionFieldMenu, selectedTable, a.qName);
					});
				}

				// Remove all dimensions. Don't show when the context is the only dimension
				if (numDimensions && ! (isDimension(column) && 1 === numDimensions)) {
					removeColumnMenuItems.push({
						label: "Remove all dimensions",
						tid: "remove-all-dimensions",
						select: function() {
							removeAllTableDimensions($scope, selectedTable);
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

					// Add single field or dimension measures
					if (column.isDimension) {
						addMeasureMenuItems(addMeasureMenu, selectedTable, column.text, cell.colIx, isDimension(column));

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
				if (columnIsField) {
					menu.addItem({
						label: "Remove field '".concat(column.text, "'"),
						tid: "remove-this-field",
						icon: "lui-icon lui-icon--cut",
						select: function() {
							removeTableField($scope, selectedTable, column.text);
						}
					});

				// Remove this dimension
				} else if (isDimension(column)) {
					menu.addItem({
						label: "Remove dimension '".concat(column.text, "'"),
						tid: "remove-this-dimension",
						icon: "lui-icon lui-icon--cut",
						select: function() {
							removeTableDimension($scope, selectedTable, cell.colIx);
						}
					});

				// Remove this measure
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
						app.getObject($scope.tableInspectorId).then( function( model ) {

							// Open export modal
							exportDialog.show(model);
						});
					}
				});

			// When the profile table is active
			} else if ($scope.tableProfileId) {

				// View table inspector
				menu.addItem({
					label: "View table inspector",
					tid: "view-table-inspector",
					icon: "lui-icon lui-icon--back",
					select: function() {
						$scope.fsm.select();
					}
				});

				// Reset inspector
				menu.addItem({
					label: "Reset inspector",
					tid: "reset-inspector",
					icon: "lui-icon lui-icon--close",
					select: function() {
						resetExtensionVisualization($scope);
					}
				});

				// Export data
				menu.addItem({
					translation: "contextMenu.export",
					tid: "export",
					icon: "lui-icon lui-icon--export",
					select: function() {
						app.getObject($scope.tableProfileId).then( function( model ) {

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
	 * @param  {Object} exportedFmt       Export model from the originating visualization
	 * @param  {Object} initialProperties Initial properties of this extension
	 * @param  {Object} ext               Extension object
	 * @param  {String} hyperCubePath     Hypercube path (?)
	 * @return {Object}                   Export model
	 */
	importProperties = function( exportedFmt, initialProperties, ext, hyperCubePath ) {
		var retval = objectConversion.hypercube.importProperties.apply(this, arguments);

		// Overwrite metadata
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

		// Add dimensions from the table inspector
		propertyTree.qProperty.props.tableDimensions.forEach( function( dimension ) {
			retval.data[0].dimensions.push(createHyperCubeDefDimension(dimension));
		});

		// Add measures from the table inspector
		propertyTree.qProperty.props.addedMeasures.forEach( function( measure ) {
			retval.data[0].measures.push(createHyperCubeDefMeasure(measure));
		});

		// Reset metadata
		retval.properties.showTitles = true;
		retval.properties.title = "";

		return retval;
	};

	// Find the appprops object and subscribe to layout changes
	// This listener remains running in memory without end, but it is only
	// created once for all instances of this extension.
	app.getObject("AppPropsList").then( function( obj ) {
		obj.layoutSubscribe( function() {

			// Set the current theme
			app.theme.getApplied().then( function( theme ) {
				currTheme = theme;
			});
		});
	});

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

			// Close the active state to remove any visualization
			this.$scope.fsm.close();
		},

		support: {
			cssScaling: false,
			sharing: false,
			snapshot: false,
			export: false,
			exportData: false // This applies for the app inspector. Data export is supported for the inspector table
		}
	};
});
