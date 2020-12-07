const functions = require('firebase-functions');
const admin = require("firebase-admin");
const excelToJson = require('convert-excel-to-json');
const request = require('request');
const fs = require('fs');
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
var app = admin.initializeApp();
const db = admin.firestore();

exports.activateExcelFileByImportId = functions.https.onCall(async (data, context) => {

	try {
		const importObj = await getDocumentByID("imports", data.importId);
		const filePath = await getRemoteFile(importObj.url, importObj.filename);
		const keyObj = await getDocumentByID("keys", data.keyId);
		const excelJSON = excelToJSON(filePath);
		const wooCommerceKey = connectToWooCommerce(keyObj);

		const newCategories = excelJSON['categories'];
		const newAttributes = excelJSON['product_attributes'];
		const attributes = excelJSON['attributes'];
		const newVariations = excelJSON['variations'];

		const currentProductAttributes = await getCollection("products/attributes", wooCommerceKey);		
		const currentProductAttributeIds = currentProductAttributes.data.map(categorie => {return categorie.id})
		const deletedProductAttributes = await batchDelete("products/attributes", wooCommerceKey, currentProductAttributeIds)
		const productAttributesResponse = await batchCreate("products/attributes", wooCommerceKey, newAttributes);
		const createdAttributes = productAttributesResponse.data.create;
		
		for(var i=0; i < createdAttributes.length; i++) {
			const createdAttr = createdAttributes[i];
			const t = newAttributes.find(newAttr =>  newAttr.name == createdAttr.name)
			const termsArr = t.terms.split("|")
			const attrTerms = termsArr.map(termName => { return {"name":termName} });
			const attributeId = createdAttr.id
			const productAttributeEndpoint = `products/attributes/${attributeId}/terms`
			const currentAttributesTerms = await getCollection(productAttributeEndpoint, wooCommerceKey);		
			const currentAttributesTermIds = currentAttributesTerms.data.map(categorie => {return categorie.id})
			const deletedAttributesTerms = await batchDelete(productAttributeEndpoint, wooCommerceKey, currentAttributesTermIds)
			const attributesTermsResponse = await batchCreate(productAttributeEndpoint, wooCommerceKey, attrTerms);
			
		}


		const currentCategories = await getCollection("products/categories", wooCommerceKey);		
		const currentCategoriesIds = currentCategories.data.map(categorie => {return categorie.id})
		const deletedCategories = await batchDelete("products/categories", wooCommerceKey, currentCategoriesIds)
		const categories = await batchCreate("products/categories", wooCommerceKey, newCategories);
		
		var productsWithCategories = []

		const createdCategories = categories.data.create;
		createdCategories.forEach(categorie => { 
			var products = excelJSON[categorie.name]; 
			if(products != undefined) {
				products.forEach(product => {
					product.categories = [{id:categorie.id}]
					productsWithCategories.push(product)
				})
			}
		})


		const currentProducts = await getCollection("products", wooCommerceKey);
		const currentProductIds = currentProducts.data.map(product => {return product.id})
		const deletedProducts = await batchDelete("products", wooCommerceKey, currentProductIds)
		const batch = await batchCreate("products", wooCommerceKey, productsWithCategories);
		const createdProducts = batch.data.create


		var batchVariations = []
		var variationKeys = ["attribute1","attribute2","attribute3","attribute4","attribute5", ,"attribute6", ,"attribute7", ,"attribute8", ,"attribute9", ,"attribute10"]
		var atributeRequests = []
		for (var i = 0; i < newVariations.length; i++) {
			var variatioObj = {}
			var variation = newVariations[i]
			var variationProduct = createdProducts.find(product => product.slug == variation.product)
			
			var atributeRequest = {}
			atributeRequest.variations = []
			atributeRequest.url = ""

			if(variationProduct){
				variation.attributes = []
				delete variation.product
				for(var j=0; j < variationKeys.length; j++) {
					const attrKey = variationKeys[j]
					const attr = variation[attrKey]
					if(attr) {
						const arrArr = attr.split(",")
						const attrSlug = arrArr[0]
						const variationOption1 = arrArr[1]
						const createAttr = createdAttributes.find(attr => attr.slug == `pa_${attrSlug}`)
						variationAttrID = createAttr.id
						const variationObj = {id:variationAttrID, option:variationOption1}
						variation.attributes.push(variationObj)
						delete variation[attrKey]
					}
				}


				var productVariationEndpoint = `products/${variationProduct.id}/variations`
				
				console.log("Variations")
				console.log(variation)

				//const currentProductVariations = await getCollection(productVariationEndpoint, wooCommerceKey);
				// const currentProductVariationIds = currentProductVariations.data.map(product => {return product.id})
				// const deletedProductVariations = await batchDelete(productVariationEndpoint, wooCommerceKey, currentProductVariationIds)
				const batch = await postTo(productVariationEndpoint, wooCommerceKey, variation);	
				


			}


		}



		attributes.map(attr => {
			attr.options = attr.options.split(",")
			return  attr
		})

		var productsToUpdate = []

		for(var i=0; i < attributes.length; i++) {
			const productReq = {}
			productReq.attributes = []
			productReq.url = ""

			const attribute = attributes[i];
			var product = createdProducts.find(createdProduct => createdProduct.slug == attribute.product_slug)
			delete attribute.product_slug
			if(product) {
				const apiEndpoint = `products/${product.id}`
				productReq.url = apiEndpoint
				productReq.attributes.push(attribute)
				productsToUpdate.push(productReq)
			}	

		}

		
		for(var i=0; i < productsToUpdate.length; i++) {
			const defaultAttrs = []
			const productToRequest = productsToUpdate[i];
			const endpoint = productToRequest.url;
			const attrArr = productToRequest.attributes;
			const variation = await updateOne(endpoint, wooCommerceKey, { attributes:attrArr });
			
			for(var i=0; i < attrArr.length; i++ ) {
				const attr = attrArr[i];
				const firstOptionInArr = attr.options[0]
				const firstAttrName = attr.name;
				const defaultAttr = {}
				defaultAttr.name = firstAttrName
				defaultAttr.option = firstOptionInArr
				defaultAttrs.push(defaultAttr)
			}

			const defaultAtt = await updateOne(endpoint, wooCommerceKey, { default_attributes:defaultAttrs });
		}

		


		// const currentProductVariations = await getCollection(productVariationEndpoint, wooCommerceKey);
		// const currentProductVariationIds = currentProductVariations.data.map(product => {return product.id})
		// const deletedProductVariations = await batchDelete(productVariationEndpoint, wooCommerceKey, currentProductVariationIds)
		// const batch = await batchCreate(productVariationEndpoint, wooCommerceKey, productsWithCategories);
		// const createdProducts = batch.data.create	



		// productAttributesResponse.data.create.forEach(attr => {

		// }) 






		// const menuItems = newCategories.map(cat => { 
		// 	return {"title":cat.name, "class":cat.name, "url":`/product-category/${cat.name}`, "status":"publish"}   
		// })

		// var navigationMenu = await deleteAndInsert("navigation_menu", menuItems, wooCommerceKey);

		// productsWithCategories.forEach(product => {
		// 	const images = product.images
			
		// 	product.meta_data = [
  //           {
  //               "key": "_pizzatime",
  //               "value": "yes"
  //           }
  //       ]

		// 	product.images = [images].map(image => { return {"src":image} })
		// })
		




		// // Delete and insert toppings
		// const toppings = excelJSON['toppings'];
		// var toppingsResponse = await deleteAndInsert("toppings", toppings, wooCommerceKey);

		// // Delete and insert cheeses
		// const cheeses = excelJSON['cheeses'];
		// var cheesesResponse = await deleteAndInsert("cheeses", cheeses, wooCommerceKey);

		// // Delete and insert crusts
		// const crusts = excelJSON['crusts'];
		// var crustsResponse = await deleteAndInsert("crusts", crusts, wooCommerceKey);

		// // Delete and insert custom_ingredients
		// const customIngredients = excelJSON['custom_ingredients'];
		// var customIngredientsResponse = await deleteAndInsert("custom_ingredients", customIngredients, wooCommerceKey);

		// // Delete and insert dressings
		// const customDressings = excelJSON['dressings'];
		// var customDressingsResponse = await deleteAndInsert("dressings", customDressings, wooCommerceKey);

		// // Delete and insert customMeats
		// const customMeats = excelJSON['meats'];
		// var customMeatsResponse = await deleteAndInsert("meats", customMeats, wooCommerceKey);

		// // Delete and insert presets
		// const customPresets = excelJSON['presets'];
		// var customPresetsResponse = await deleteAndInsert("presets", customPresets, wooCommerceKey);

		// // Delete and insert prices to sizes
		// const customPricesToSizes = excelJSON['prices_to_sizes'];
		// var customPricesToSizesResponse = await deleteAndInsert("prices_to_sizes", customPricesToSizes, wooCommerceKey);

		// // Delete and insert sauces
		// const sauces = excelJSON['sauces'];
		// var saucesResponse = await deleteAndInsert("sauces", sauces, wooCommerceKey);

		// // Delete and insert sizes
		// const sizes = excelJSON['sizes'];
		// var sizesResponse = await deleteAndInsert("sizes", sizes, wooCommerceKey);

		// // Delete and insert sizes
		// const sizesToPresets = excelJSON['sizes_to_presets'];
		// var sizesToPresetsResponse = await deleteAndInsert("sizes_to_presets", sizesToPresets, wooCommerceKey);

		return productAttributesResponse.data.create

	}catch(err) {
		throw err
	}
});

function search(nameKey, myArray){
    for (var i=0; i < myArray.length; i++) {
        if (myArray[i].name === nameKey) {
            return myArray[i];
        }
    }
}


async function deleteAndInsert($uri, $Arr, wooCommerceKey) {
	var response = await postTo($uri, wooCommerceKey, $Arr);
	var obj = response.data;
	return obj;
}

async function postTo($uri, wooCommerceKey, data) {
	return await wooCommerceKey.post($uri, data);
}

async function updateOne($uri, wooCommerceKey, data) {
	return await wooCommerceKey.put($uri, data);
}

async function batchDelete(resource, wooCommerceKey, deleteIds) {
	const data = {
	  create:[],
	  update:[],
	  delete:deleteIds

	}
	return wooCommerceKey.post(`${resource}/batch`, data)
}
async function batchUpdate(resource, wooCommerceKey, updateObjs) {
	const data = {
	  create:[],
	  update:updateObjs,
	  delete:[]

	}
	return wooCommerceKey.put(`${resource}/batch`, data)
}

async function batchCreate(resource, wooCommerceKey, create) {
	const data = {
	  create:create,
	  update:[],
	  delete:[]

	}
	return wooCommerceKey.post(`${resource}/batch`, data)
}

async function getCollection(name, wooCommerceKey) {
	return await wooCommerceKey.get(name)
}

async function getProducts(wooCommerceKey) {
	return await wooCommerceKey.get("products")
}

async function getToppings(wooCommerceKey) {
	return await wooCommerceKey.get("toppings")
}

function connectToWooCommerce(keyObj) {
	return new WooCommerceRestApi({
	  url: keyObj.url,
	  consumerKey: keyObj.consumerKey,
	  consumerSecret: keyObj.consumerSecret,
	  version: 'wc/v3',
	  queryStringAuth: true
	});
}



async function addProduct(newProduct, wooCommerce) {
	return new Promise(async function(resolve, reject){
		try {
			let product = await wooCommerce.post("products", newProduct);
			resolve(product);
		}catch(err) {
			reject(new functions.https.HttpsError('invalid-argument', err.message))
		}
	})
}

async function getDocumentByID(collection, id) {
	let profileRef = db.collection(collection).doc(id);
	return new Promise(function(resolve, reject){
		return profileRef.get().then(chatRoom => {
			if(!chatRoom.exists){ return reject(new functions.https.HttpsError('invalid-argument', 'Record doesnt exist')) }
			return resolve(chatRoom.data());
		})
	})
} 


async function getRemoteFile(url, filename) {
	return new Promise(async function(resolve, reject){
		const writeStream = await request(url).pipe(fs.createWriteStream(`/tmp/${filename}`, { mode: 0o755 }))
		writeStream.on('finish', function(){
			resolve(writeStream.path);
		})
	})
}

function excelToJSON(filePath) {

	const productAddOnColumn = {
		        A: 'name',
		        B: 'image',
		        C: 'image_extra',
		        D: 'image_path',
		        E: 'image_extra_path',
		        F: 'photo',
		        G: 'description',
		        H: 'price',
		        I: 'price_extra',
		        J: 'preset_price_extra',
		        K: 'weight',
		        L: 'weight_extra',
		        M: 'has_extra',
		        N: 'has_left_right',
		        O: 'is_ingredient',
		        P: 'status',
		        Q: 'layer',
		        R: 'sort_order',
		        S: 'opacity',
		        T: 'has_four_sides'
	    	}
	   


	return excelToJson({
	    source: fs.readFileSync(filePath),
	    header:{
	        // Is the number of rows that will be skipped and will not be present at our result object. Counting from top to bottom
	        rows: 1 // 2, 3, 4, etc.
	    },
	    sheets:[{
	    	name: 'pizzas',
	    	columnToKey: {
		        A: 'name',
		        B: 'type',
		        C: 'regular_price',
		        D: 'description',
		        E: 'short_description',
		        F:'categories',
		        G:'images'
	    	}
	    },
	    {
	    	name: 'product_attributes',
	    	columnToKey: {
		        A: 'name',
		        B: 'slug',
		        C: 'type',
		        D: 'order_by',
		        E: 'has_archives',
		        F: 'terms'
	    	}
	    },
	    {
	    	name: 'attributes',
	    	columnToKey: {
		        A: 'product_slug',
		        B: 'name',
		        C: 'position',
		        D: 'visible',
		        E: 'variation',
		        F: 'options'
	    	}
	    },
	    {
	    	name: 'drinks',
	    	columnToKey: {
		        A: 'name',
		        B: 'slug',
		        C: 'type',
		        D: 'regular_price',
		        E: 'description',
		        F: 'short_description',
		        G:'categories',
		        H:'images'
	    	}
	    },
	    {
	    	name: 'categories',
	    	columnToKey: {
		        A: 'name',
		        B: 'slug',
		        C: 'parent',
		        D: 'description',
		        E: 'display',
		        F: 'image',
		        G: 'menu_order',
		        H: 'count',
	    	}
	    },
	    {
	    	name: 'toppings',
	    	columnToKey: productAddOnColumn
	    },
	    {
	    	name: 'cheeses',
	    	columnToKey: productAddOnColumn
	    },
	    {
	    	name: 'crusts',
	    	columnToKey: {
	    		A: "name",
	    		B: "description",
	    		C: "image",
	    		D: "image_path",
	    		E: "photo",
	    		F: "price",
	    		G: "weight",
	    		H: "weight_extra",
	    		I: "status",
	    		J: "sort_order",
	    		K: "opacity"
	    	}
	    },
	    {
	    	name: 'custom_ingredients',
	    	columnToKey: productAddOnColumn
	    },
	    {
	    	name: 'dressings',
	    	columnToKey: productAddOnColumn
	    },
	    {
	    	name: 'meats',
	    	columnToKey: productAddOnColumn
	    },
	    {
	    	name:'sizes',
	    	columnToKey: {
	    		A: 'name',
	    		B: 'description',
	    		C: 'photo',
	    		D: 'price',
	    		E: 'price_multiplier',
	    		F: 'weight_multiplier',
	    		G: 'status',
	    		H: 'sort_order',
	    	}
	    },
	    {
	    	name:'presets',
	    	columnToKey: {
	    		A: 'name',
	    		B: 'size',
	    		C: 'crust',
	    		D: 'sauce',
	    		E: 'cheese',
	    		F: 'sections',
	    		G: 'sizes',
	    		H: 'sauces',
	    		I: 'cheeses',
	    		J: 'meats',
	    		K: 'toppings',
	    		L: 'dressings',
	    		M: 'custom_ingredients',
	    		N: 'sizes_available',
	    		O: 'crusts_available',
	    		P: 'sauces_available',
	    		Q: 'cheeses_available',
	    		R: 'meats_available',
	    		S: 'toppings_available',
	    		T: 'dressings_available',
	    		U: 'custom_ingredients_available',
	    	}
	    },
	    {
	    	name:'prices_to_sizes',
	    	columnToKey: {
	    		A: 'category',
	    		B: 'ingredient_id',
	    		C: 'size_id',
	    		D: 'price',
	    		E: 'price_type'
	    	}
	    },
	    {
	    	name: 'sauces',
	    	columnToKey: productAddOnColumn
	    },
	    {
	    	name:'sizes_to_presets',
	    	columnToKey: {
	    		A: 'size_id',
	    		B: 'preset_id',
	    		C: 'price',
	    		D: 'price_multiplier'
	    	}
	    },
	    {
	    	name:'variations',
	    	columnToKey: {
	    		A: 'product',
	    		B: 'regular_price',
	    		C: 'image',
	    		D: 'attribute1',
	    		E: 'attribute2',
	    		F: 'attribute3',
	    		G: 'attribute4',
	    		H: 'attribute5',
	    		I: 'attribute6',
	    		J: 'attribute7',
	    		K: 'attribute8',
	    		L: 'attribute9',
	    		M: 'attribute10'
	    	}
	    }],
	});	
}

class Product {
	constructor(name, type = "simple", regularPrice, description, shortDescription, categories = [], images = []) {
		this.name = name
		this.type = type
		this.regularPrice = regularPrice
		this.description = description
		this.shortDescription  = shortDescription
		this.categories = categories
		this.images = images
	}
}
