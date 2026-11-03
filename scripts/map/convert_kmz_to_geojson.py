import os
import sys
import json
import zipfile
import xml.etree.ElementTree as ET
from shapely.geometry import shape, Point, LineString, Polygon, mapping
from coordTransform_utils import gcj02_to_wgs84


def convert_kmz_to_geojson(kmz_file_path, geojson_file_path):
    with zipfile.ZipFile(kmz_file_path, 'r') as kmz:
        kml_content = kmz.read('doc.kml')
        
        root = ET.fromstring(kml_content)
        geojson_content = kml_to_geojson(root)
        
        with open(geojson_file_path, 'w') as geojson_file:
            json.dump(geojson_content, geojson_file, indent=4)

def kml_to_geojson(element):
    geojson = {
        "type": "FeatureCollection",
        "features": []
    }

    for placemark in element.iterfind('.//{http://www.opengis.net/kml/2.2}Placemark'):
        feature = {
            "type": "Feature",
            "properties": {},
            "geometry": None
        }

        for name in placemark.iterfind('.//{http://www.opengis.net/kml/2.2}name'):
            feature["properties"]["name"] = name.text
        
        for description in placemark.iterfind('.//{http://www.opengis.net/kml/2.2}description'):
            feature["properties"]["description"] = description.text

        for point in placemark.iterfind('.//{http://www.opengis.net/kml/2.2}Point'):
            coords = point.find('{http://www.opengis.net/kml/2.2}coordinates').text.strip()
            lon, lat, _ = map(float, coords.split(','))
            feature["geometry"] = mapping(Point(gcj02_to_wgs84(lon, lat)[0], gcj02_to_wgs84(lon, lat)[1]))
        
        for linestring in placemark.iterfind('.//{http://www.opengis.net/kml/2.2}LineString'):
            coords = linestring.find('{http://www.opengis.net/kml/2.2}coordinates').text.strip()
            points = [tuple(map(float, coord.split(',')))[:2] for coord in coords.split()]
            feature["geometry"] = mapping(LineString(points))
        
        for polygon in placemark.iterfind('.//{http://www.opengis.net/kml/2.2}Polygon'):
            outer_boundary = polygon.find('.//{http://www.opengis.net/kml/2.2}outerBoundaryIs')
            if outer_boundary is not None:
                coords = outer_boundary.find('.//{http://www.opengis.net/kml/2.2}coordinates').text.strip()
                points = [tuple(map(float, coord.split(',')))[:2] for coord in coords.split()]
                feature["geometry"] = mapping(Polygon([points]))
        
        if feature["geometry"] is not None:
            geojson["features"].append(feature)
    
    return geojson

if __name__ == "__main__":
    kmz_file_path = sys.argv[1]
    geojson_file_path = sys.argv[2]
    convert_kmz_to_geojson(kmz_file_path, geojson_file_path)
