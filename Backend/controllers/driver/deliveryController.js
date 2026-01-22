import deliveryService from "../../services/driver/deliveryQuery.js"
import HttpStatus from "../../utils/statusCodes.js"
import { translateError } from "../../utils/backendI18n.js";

// Helper to get language from request
const getLang = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

const getDeliverySummary = async(req,res)=>{
    try {
        const lang = getLang(req);
        const driverId = req.params.driverId
        const {from_date,to_date}=req.query

         if (!driverId) {
            return res.status(HttpStatus.BAD_REQUEST).json({ 
                message: translateError(lang, 'driver.driverIdRequired')
            });
        }

         if ((from_date && !to_date) || (!from_date && to_date)) {
            return res.status(HttpStatus.BAD_REQUEST).json({ 
                message: translateError(lang, 'delivery.bothDatesRequired')
            });
        }


        // Validate date format (YYYY-MM-DD)
        if (from_date && to_date) {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(from_date) || !dateRegex.test(to_date)) {
                return res.status(HttpStatus.BAD_REQUEST).json({ 
                    message: translateError(lang, 'delivery.invalidDateFormat')
                });
            }

            // Validate from_date is not after to_date
            if (new Date(from_date) > new Date(to_date)) {
                return res.status(HttpStatus.BAD_REQUEST).json({ 
                    message: translateError(lang, 'delivery.fromDateAfterToDate')
                });
            }
        }



        const data= await deliveryService.fetchDeliverySummary(driverId,from_date,to_date)
        console.log(translateError(lang, 'delivery.fetchedDeliveries') + ":", data.length);
        res.status(HttpStatus.OK).json(data)
    } catch (error) {
        const lang = getLang(req);
        console.error(translateError(lang, 'delivery.queryFailed') + ":", error)

        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
            message: translateError(lang, 'delivery.failedToFetchSummary')
        })
    }
}

export default getDeliverySummary