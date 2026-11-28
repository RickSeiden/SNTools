# SNPlugins

**[NOW PUBLISHED ON THE CHROME STORE](https://chromewebstore.google.com/detail/snplugins/phnegldlndamckegkbmkboofmmjjghpk)**

**AI Disclosure:** This was written with the aid of Gemini.

SNPlugins is a "plugin management system" of sorts. The Chromium based extension allows you to create JavaScript code segments that run inside of ServiceNow without making any changes to the instance.

SNPlugins is **not** a replacement for [SNUtils](https://snutils.com/). SNPlugins is **not** meant to "compete" with SNUtils.  I use SNUtils every day at work, and believe it is an incredible tool.  Anything that is done in SNPlugins could be incorporated into SNUtils, and very well may be in the future.

SNPlugins is meant to give you the opportunity to write code snippets that do things other tools, like SNUtils, don't currently do.

##### Current Features



* Inserting an element via a config JSON Object (see below)
* Hiding an element on the page
* Access g\_form
* GET REST calls to retrieve data
* Standardized console logging (Starts with "[SNPlugins]" so it's easier to find in the flood of messages)
* Finding an element via the developer tools console
* Library plugins that don't directly act, but can be called from other plugins
* Export all plugins to a JSON file
* Export a single plugin to a JSON file
* Import plugins from a JSON file
* Enable and disable the extension without using Extensions Manager



##### Finding an element

Because ServiceNow uses shadow roots and iframes, it can be difficult to find the element you want to work with.  To help with this, the SNPlugins API has a getWaitFor function. To use it, open the developer tools in your browser, and press Control-Shift-C (sorry, Mac, I don't know) then select your element on the ServiceNow page.



Once selected, in your browser, enter:



top.SNPlugins.getWaitFor($0)



SNPlugins will give you a text string that you can use to hide or otherwise work with that element.



##### The basic plugin

The most basic plugin is given to you when you click the New button to start a new plugin

```
SNPlugins.onRouteChange(async () => {
  const record = SNPlugins.getRecord();
  if (!record || record.isWorkspace) return;
});
```
Your code goes after the if statement.



##### Adding an element

To add an element to the form, use one of the SNPlugins.add functions



* addInsideAfter
  * Adds the element inside the flex at the end
* addInsideBefore
  * Adds the element inside the flex as the first element
* addAfter
  * Adds the element outside the flex after it
* addBefore
  * Adds the element outside the flex before it

All of them take two parameters

* selector
  * The text string retrieved from SNPlugins.getWaitFor()
* config
  * A JSON object describing the element to add

```
config: {
  timeout: number of milliseconds to search for selector before timing out,
  id: The HTML id of the element to add,
  tag: The HTML tag of the element to add (a, div, span...),
  type: Set to "button" for buttons to keep them from submitting the form,
  className: The HTML class of the element to add,
  textContent: The text to place in the tag (can also be specified as textContext or text,
  html: The HTML element's innerHTML,
  title: The HTML element's title attribute
  attrs: {
  	key: value pairs of attributes
  },
  flexParent: true/false to place insideAfter or insideBefore elements inside the flex anyway
}
```

`config` can also include any onaction (onclick, onchange, onmouseover...) a shown below.



##### Examples

This config creates a standard <a href> link to https://www.google.com
```
{
   id: 'google\_link',
   tag: 'a',
   attrs : {
     href: "https://www.google.com",
     target: "\_blank"
   },
   className: 'navigation\_link action\_context default-focus-outline',
   textContent: 'Google',
}
```



This config creates a button that copies the sys\_id of the current record and shows how to add on onclick function



```
{
 id: 'my-copy-btn',
 type: 'button',
 className: 'btn btn-default',
 textContent: 'Copy SysID!',
 flexParent: true,
 onclick(e) {
   const btn = e.currentTarget;
   navigator.clipboard.writeText(record.sysId);
   btn.textContent = 'Copied!';
   setTimeout(() => {
      btn.textContent = 'Copy SysID';
   }, 1500);
  }
}
```

#### GET REST Calls
The example below shows getting a single incident back via a REST call.
```
SNPlugins.onRouteChange(async () => {
    try {
        const record = SNPlugins.getRecord();
        if (!record || record.isWorkspace) return;

        let data = await SNPlugins.REST("/api/now/table/incident?sysparm_limit=1");
        SNPlugins.console(JSON.stringify(data.result, null, 2));

    } catch (e) {
        SNPlugins.console(e.message, 'error');
    }
});
```
