---
Type: Qlik Sense Visualization Extension
Name: E-mergo Table Inspector
Version: 1.4-beta
QEXT: qs-emergo-table-inspector.qext
---

# E-mergo Table Inspector

**E-mergo Table Inspector** is a Qlik Sense visualization extension created by [E-mergo](https://www.e-mergo.nl). This extension enables the dashboard designer to quickly inspect the contents of virtual data tables that make up an app's datamodel.

This extension is part of the [E-mergo Tools bundle](https://www.e-mergo.nl/e-mergo-tools-bundle/?utm_medium=download&utm_source=tools_bundle&utm_campaign=E-mergo_Extension&utm_term=toolsbundle&utm_content=sitelink).

This extension is [hosted on GitHub](https://github.com/e-mergo/qs-emergo-table-inspector). You can report bugs and discuss features on the [issues page](https://github.com/e-mergo/qs-emergo-table-inspector/issues).

## Why is this extension needed?
A seasoned Qlik Sense app developer sees herself frequently inspecting the contents of an app's datamodel. Next to using the data model viewer this frequently happens by setting up a straight table and adding the fields of interest. When inspecting a multitude of data tables, or of data tables with many fields, this task quickly becomes time consuming.

Previously, the community's extension named 'xTableBox' provided a solution for this. However, it no longer supports newer versions of Qlik Sense. This extension also had its flaws, for example it did not stay synchronized with changes in the app's data model. A proper alternative was not seen until now.

This E-mergo extension provides a singular fast way for inspecting data tables, by automatically fetching all fields for the selected table. This includes keeping the visualization in sync with the app's data model by updating the visualization on addition and removal of fields applied in the reload. Also, switching between data tables can be done in two clicks, without the need for selecting or removing a single field in the visualization.

Additionally, the extension utilizes Qlik Sense's internal API's (for generating a generic straight table), without adding custom logic or markup, providing a seamless and familiar user experience within the Qlik Sense environment.

## Disclaimer
This extension is created free of charge for Qlik Sense app developers, personal or professional. E-mergo developers aim to maintain the functionality of this extension with each new release of Qlik Sense. However, this product does not ship with any warranty of support. If you require any updates to the extension or would like to request additional features, please inquire for E-mergo's commercial plans for supporting your extension needs at support@e-mergo.nl.

On server installations that do not already have it registered, the Markdown file mime type will be registered when opening the documentation page. This is required for Qlik Sense to be able to successfully return `.md` files when those are requested from the Qlik Sense web server. Note that registering the file mime type is only required once and is usually only allowed for accounts with RootAdmin level permissions.

## Features
Below is a detailed description of the available features of this extension.

### No Settings
This extension is plug-and-play as it works with zero property settings. Insert the extension on a sheet and start selecting your data table! All the extension's options are available in the visualization's **context menu** (right-click).

### Select table
When in Analysis mode, select a data table through the `Select Table` popup window. When a data table is already selected switch to a different data table by selecting `Switch table` in the visualization's context menu (right-click).

### Reset inspector
Clear the selected data table by selecting `Reset inspector` in the visualization's context menu (right-click).

### Removing and adding fields
Remove or re-add fields by selecting `Remove field` or `Add field` in the visualization's context menu (right-click). The context menu also provides an option for removing all but the selected field, as well as adding all removed fields back in again.

### Adding and removing dimensions
Add or remove dimensions based on a field by selecting `Add dimension` or `Remove dimension` in the visualization's context menu (right-click). The context menu also provides an option for removing all dimensions when any dimensions are added. The available dimensions for a field are categorised according to [Qlik's function help documentation](https://help.qlik.com/en-US/sense/November2022/Subsystems/Hub/Content/Sense_Hub/Scripting/functions-in-scripts-chart-expressions.htm):
- Formatting functions
  - Date
  - Interval
  - Money
  - Num
  - Time
  - Timestamp
- General numeric functions
  - BitCount
  - Ceil
  - Even
  - Fabs
  - Fact
  - Floor
  - Frac
  - Odd
  - Round
  - Sign
- Logical functions
  - IsNum
  - IsText
- NULL functions
  - EmptyIsNull
  - IsNull
- String functions
  - Capitalize
  - Chr
  - Evaluate
  - Len
  - Lower
  - LTrim
  - Ord
  - RTrim
  - Trim
  - Upper

### Adding and removing measures
Add or remove measures based on a field by selecting `Add measure` or `Remove measure` in the visualization's context menu (right-click). The context menu also provides an option for removing all measures when any measures are added. Quick selections are provided for Sum, Count, Count Distinct. The available measures for a field are categorised according to [Qlik's function help documentation](https://help.qlik.com/en-US/sense/November2022/Subsystems/Hub/Content/Sense_Hub/Scripting/AggregationFunctions/aggregation-functions.htm):
- Basic aggregation
  - Max
  - Min
  - Mode
  - Only
  - Sum
- Counter aggregation
  - Count
  - Count Distinct
  - MissingCount
  - MissingCount Distinct
  - NullCount
  - NullCount Distinct
  - NumericCount
  - NumericCount Distinct
  - TextCount
  - TextCount Distinct
- Statistical aggregation
  - Avg
  - Kurtosis
  - Median
  - Skew
  - Stdev
  - Sterr
- String aggregation
  - Concat Distinct
  - MaxString
  - MinString

### Remove columns
To remove other columns but the selected column, choose one of the alternatives in the context menu (right-click), depending on the context:
- Remove all other columns
- Remove all columns to the left
- Remove all columns to the right
- Remove all fields
- Remove all dimensions
- Remove all measures
- Remove a different single field

### Row and column counts
When viewing a data table, the extension's footer displays various counts of the table's data: the full data table size (columns by rows), and the visible table size (columns by rows).

### View table profile
Optionally the data table's metadata is available in the table profile view. Choose `View table profile` in the visualization's context menu (right-click) or in the table's footer. Per field in the data table the following statistics are presented:
- Unique value count
- Uniqueness ratio (unique value count divided by table row count)
- Subset ratio (unique value count divided by total unique value count)
- Null value count
- Density (non-null value count divided by table row count)
- Text value count
- Numeric value count
- Empty string count
- Positive number count
- Negative number count
- Zero number count
- Tags
- Field comment

### Convert to table
When in Edit mode, quickly convert the selected data table to an actual straight table by selecting the `Convert to: Table` button or in the visualization's context menu (right-click). Converting to a straight table or any other visualization is also possible through the conventional way of converting a visualization to a different type.

## FAQ

### Can I get support for this extension?
E-mergo provides paid support through standard support contracts. For other scenarios, you can post your bugs or questions in the extension's GitHub repository.

### Can you add feature X?
Requests for additional features can be posted in the extension's GitHub repository. Depending on your own code samples and the availability of E-mergo developers your request may be considered and included.

## Changelog

#### 1.4-beta - QS November 2022
- Ready for Qlik Cloud.
- Renamed extension label to improve discoverability in the extensions list.
- Added the _Copy cell value_ action for table cells in the context menu.
- Added the option to insert and remove dimensions for a selected field.
- Added the option to insert and remove measures for a selected field.
- Added the option to quickly convert the selected data table to a straight table visualization.
- Added the option to remove all fields to the left or right of the selected field.
- Added a row and column count in the extension's footer.
- Added the table profile view.
- Removed the requirement to always keep at least one field.
- Fixed inserting new columns at the position of the context menu.
- Fixed extension interaction when in noInteraction mode.
- Updated docs files.

#### 1.3.20200918 - QS September 2022
- Fixed the layout for smaller extension object sizes.

#### 1.2.20200731
- Fixed a bug where the extension would result in an error when embedded.
- Fixed logic for the _Open Documentation_ button.

#### 1.1.20200706
- Fixed a bug where the export data dialog would not open in QS April 2020 and up.

#### 1.0.20200623
- Updated docs files.

#### 1.0.20200622
- Fixed internal naming and updated docs.

#### 0.2.20200227
- Added loading spinner for selections of large data tables.
- Added auto-sync for removed data tables.
- Fixed handling of synthetic tables and keys.
- Fixed incorrect context menu items for table cells outside of data columns.

#### 0.1.20200114
Initial release.
